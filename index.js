const mqtt = require('mqtt');
const UrlPattern = require('url-pattern');

class ServerConnectionOptions {
  constructor() {
    this.options = {
      mqttEndpoint: null,
      mqttUsername: 'remoteclient',
      mqttPassword: null,
      hardwareType: null,
      serialNumber: null,
      publishWhitelist: [],
      subscribeWhitelist: [],
      connectionId: ''
    };
  }

  set(key, value) {
    if(this.options[key] === undefined) {
      throw "Invalid key provided (" + key + ")";
    }

    if(value === undefined) {
      throw "Invalid value provided, undefined (" + key + ")";
    }

    this.options[key] = value;
  }

  get(key) {
    if(this.options[key] === undefined) {
      throw "Invalid key requested (" + key + ")";
    }

    return this.options[key];
  }
}

class ServerConnection {
  constructor(options) {
    if(!options instanceof ServerConnectionOptions) {
      throw "Options must be passed";
    }

    this.hardwareType = options.get('hardwareType');
    this.serialNumber = options.get('serialNumber');
    this.publishWhitelist = options.get('publishWhitelist');
    this.subscribeWhitelist = options.get('subscribeWhitelist');
    this.connectionId = options.get('connectionId');

    this.mqttEndpoint = options.get('mqttEndpoint');
    this.mqttUsername = options.get('mqttUsername');
    this.mqttPassword = options.get('mqttPassword');

    this.startedAt = null;

    var parent = this, localClient = null, globalClient = null, startedAtCounter = 0;

    var startedAtInterval = setInterval(() => {
      if(new Date().getTime() > 1609459200000) {
        parent.startedAt = new Date().getTime();
        clearInterval(startedAtInterval);
      } else {
        startedAtCounter += 1;

        if(startedAtCounter >= 10) {
          clearInterval(startedAtInterval);
        }
      }
    }, 500);

    console.log('MQTT Local', 'Connecting');

    localClient = mqtt.connect('mqtt://localhost');

    localClient.on('connect', () => {
      console.log('MQTT Local', 'Connected');

      localClient.subscribe(parent.hardwareType + '/' + parent.serialNumber + '/#');
      localClient.subscribe('coordinator/#');
    });

    localClient.on('message', function (topic, message) {
      console.log('MQTT Local', 'Message', topic, message.toString());

      if(parent.checkWhitelist(parent.publishWhitelist, topic)) {
        globalClient.publish(topic, message);
      } else {
        console.log('MQTT Local', 'Message not whitelisted');
      }

      var pattern1 = new UrlPattern(':hardwareType/:serialNumber/' + parent.connectionId + '/disconnect');

      if(pattern1.match(topic)) {
        console.log('MQTT Local', 'Initiating disconnection from global');

        try {
          globalClient.end(true);
        } catch(err) {
          console.error('MQTT Local', 'Error initiating disconnection from global', err);
        }
      }

      var pattern2 = new UrlPattern(':hardwareType/:serialNumber/' + parent.connectionId + '/connect');

      if(pattern2.match(topic)) {
        console.log('MQTT Local', 'Initiating connection to global');

        try {
          globalClient.reconnect();
        } catch(err) {
          console.error('MQTT Local', 'Error initiating connection to global', err);
        }
      }
    });

    console.log('MQTT Global', 'Connecting', this.mqttEndpoint, this.serialNumber);

    var options = {
      username: this.mqttUsername,
      password:  this.mqttPassword
    };

    globalClient = mqtt.connect(this.mqttEndpoint, options)

    globalClient.on('connect', function () {
      console.log('MQTT Global', 'Event', 'Connect');

      globalClient.subscribe(parent.hardwareType + '/' + parent.serialNumber + '/#');
      globalClient.subscribe('coordinator/#');

      globalClient.publish(parent.hardwareType + '/' + parent.serialNumber + '/register-device', JSON.stringify(parent.getDeviceRegistration()));
    })

    globalClient.on('reconnect', () => {
      console.log('MQTT Global', 'Event', 'Reconnect');
    });

    globalClient.on('close', () => {
      console.log('MQTT Global', 'Event', 'Close');
    });

    globalClient.on('disconnect', () => {
      console.log('MQTT Global', 'Event', 'Disconnect');
    });

    globalClient.on('offline', () => {
      console.log('MQTT Global', 'Event', 'Offline');
    });

    globalClient.on('error', (error) => {
      console.log('MQTT Global', 'Event', 'Error', error);
    });

    globalClient.on('message', function (topic, message) {
      console.log('MQTT Global', 'Event', 'Message', topic, message.toString());

      if(parent.checkWhitelist(parent.subscribeWhitelist, topic)) {
        localClient.publish(topic, message);
      } else {
        console.log('MQTT Global', 'Message not whitelisted');
      }

      var presencePattern = new UrlPattern(':hardwareType/:serialNumber/state/request(/:id)');

      if(presencePattern.match(topic)) {
        var params = presencePattern.match(topic);

        var topic = parent.hardwareType + '/' + parent.serialNumber + '/state/response';

        if(params.id !== undefined) {
          topic += '/' + params.id;
        }

        globalClient.publish(topic, JSON.stringify({
          uptime: (parent.startedAt !== null ? (new Date().getTime() - parent.startedAt) : null),
          timestamp: new Date().getTime()
        }));
      }

      if(topic == 'coordinator/device-info/request') {
        globalClient.publish(parent.hardwareType + '/' + parent.serialNumber + '/register-device', JSON.stringify(parent.getDeviceRegistration()));
      }
    })
  }

  getDeviceRegistration() {
    return {
      timestamp: new Date().getTime()
    };
  }

  checkWhitelist(whitelist, topic) {
    for(var i in whitelist) {
      var pattern = new UrlPattern(whitelist[i]);

      if(pattern.match(topic)) {
        return true;
      }
    }

    return false;
  }
}

module.exports = {
  ServerConnectionOptions: ServerConnectionOptions,
  ServerConnection: ServerConnection
};
