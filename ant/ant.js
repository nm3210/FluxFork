import { message } from './message.js';
import { xf } from '../xf.js';
import { first, empty, xor, exists, delay } from '../functions.js';
import { USB } from './usb.js';

const ChannelTypes = {
    slave: {
        bidirectional:       0x00,
        sharedBidirectional: 0x20,
        receiveOnly:         0x40,
    },
    master: {
        bidirectional:       0x10,
        sharedBidirectional: 0x30,
    }
};

const keys = {
    antPlus: [0xB9, 0xA5, 0x21, 0xFB, 0xBD, 0x72, 0xC3, 0x45],
    public:  [0xE8, 0xE4, 0x21, 0x3B, 0x55, 0x7A, 0x67, 0xC1],
};

class Channel {
    constructor(args) {
        this._channel    = args.channel    || this.defaultChannel();
        this._type       = args.type       || this.defaultType();
        this._deviceType = args.deviceType || this.defaultDeviceType();
        this._period     = args.period     || this.defaultPeriod();
        this._frequency  = args.frequency  || this.defaultFrequency();
        this._key        = args.key        || this.defaultKey();
        this.write       = args.write      || ((x) => x);
        this._status     = {};
        this.isOpen      = false;
        this.postInit(args);
    }
    postInit()          { return null; }
    get channel()       { return this._channel; }
    set channel(x)      { return this._channel = x; }
    get type()          { return this._type; }
    set type(x)         { return this._type = x; }
    get deviceType()    { return this._deviceType; }
    set deviceType(x)   { return this._deviceType = x; }
    get period()        { return this._period; }
    set period(x)       { return this._period = x; }
    get frequency()     { return this._frequency; }
    set frequency(x)    { return this._frequency = x; }
    get key()           { return this._key; }
    set key(x)          { return this._key = x; }
    get status()        { return this._status; }
    set status(x)       { return this._status = x; }
    defaultChannel()    { return 0; }
    defaultType()       { return 0; }
    defaultDeviceType() { return 0; }
    defaultPeriod()     { return 8192; }
    defaultFrequency()  { return 66; }
    defaultKey()        { return keys.public; }
    async open() {
        const self = this;
        let config = self.toMessageConfig();
        self.write(message.SetNetworkKey(config).buffer);
        self.write(message.AssaignChannel(config).buffer);
        self.write(message.ChannelId(config).buffer);
        self.write(message.ChannelFrequency(config).buffer);
        self.write(message.ChannelPeriod(config).buffer);
        self.write(message.OpenChannel(config).buffer);
        self.isOpen = true;
        console.log(`channel:open ${self.channel}`);

        self.write(message.Request({channelNumber: self.channel, request: 82}).buffer);
    }
    close() {
        const self = this;
        let config = self.toMessageConfig();
        self.write(message.UnassaignChannel(config).buffer);
        self.write(message.CloseChannel(config).buffer);
        self.isOpen = false;
        console.log(`channel:close ${self.channel}`);
    }
    toggle() {
        const self = this;
        if(self.isOpen) {
            self.close();
        } else {
            self.open();
        }
    }
    connect() {
        const self = this;
        self.open();
    }
    onData(data) {
        const self = this;
        if(self.isOpen) {
            if(message.isBroadcast(data))   { self.onBroadcast(data);   }
            if(message.isResponse(data))    { self.onResponse(data);    }
            if(message.isEvent(data))       { self.onEvent(data);       }
            if(message.isSerialError(data)) { self.onSerialError(data); }
        }
    }
    onBroadcast(data) {
        const self = this;
        return data;
    }
    onResponse(data) {
        const self = this;
        const { channel, id, code } = message.readResponse(data);
        console.log(`Channel ${channel} ${message.idToString(id)}: ${message.eventCodeToString(code)} ${data}`);
    }
    onEvent(data) {
        const self = this;
        const { channel, code } = message.readEvent(data);
        console.log(`Channel ${channel} event: ${message.eventCodeToString(code)} ${data}`);
    }
    onSerialError(error) {
        const self = this;
        console.log(`Serial error: ${error}`);
    }
    toMessageConfig() {
        const self = this;
        return {
            channelNumber: self.channel,
            channelType:   self.type,
            deviceType:    self.deviceType,
            channelPeriod: self.period,
            rfFrequency:   self.frequency,
            key:           self.key
        };
    }
}

class Hrm extends Channel {
    postInit(args) {
        xf.dispatch('ant:hrm:disconnected');
    }
    defaultChannel()    { return 1; }
    defaultType()       { return 0; }
    defaultDeviceType() { return 120; }
    defaultPeriod()     { return 8070; }
    defaultFrequency()  { return 57; }
    defaultKey()        { return keys.antPlus; }
    onBroadcast(data) {
        const { hr } = message.HRPage(data);
        if(!isNaN(hr)) {
            xf.dispatch('ant:hr', hr);
        }
    }
    connect() {
        const self = this;
        console.log(self.toMessageConfig());
        self.open();
        xf.dispatch('ant:hrm:connected');
    }
    disconnect() {
        const self = this;
        console.log(self.toMessageConfig());
        self.close();
        xf.dispatch('ant:hrm:disconnected');
    }
}

class ANT {
    constructor(args) {
        this.usb = {};
        this.hrm = {};
    }
    async init() {
        const self = this;
        self.hrm = new Hrm({write: self.write.bind(self)});

        xf.sub('usb:ready', _ => {
            console.log('usb:ready');
        });

        xf.sub('ui:ant:hrm:switch', _ => {
            if(self.hrm.isOpen) {
                self.hrm.disconnect();
            } else {
                self.hrm.connect();
            }
        });

        self.usb = new USB({onData: self.onData.bind(self)});
        await self.usb.init();
    }
    onData(data) {
        const self = this;
        if(message.isValid(data)) {
            let channel = message.readChannel(data);
            if(channel === self.hrm.channel) {
                self.hrm.onData(data);
            }
        }
    }
    write(buffer) {
        const self = this;
        self.usb.write(buffer);
    }
    async reset() {
        // reset system
    }
}

const ant = new ANT();
ant.init();

export { ant };
