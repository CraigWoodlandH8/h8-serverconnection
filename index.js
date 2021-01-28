const mqtt = require('mqtt');
const UrlPattern = require('url-pattern');

class ServerConnectionOptions {
  constructor() {
    this.options = {
      mqttEndpoint: null,
      mqttPort: null,
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
    this.mqttPort = options.get('mqttPort');
    this.mqttUsername = options.get('mqttUsername');
    this.mqttPassword = options.get('mqttPassword');

    this.startedAt = null;

    var parent = this, localClient = null, remoteClient = null, startedAtCounter = 0, startedAtOffset = 0;

    var startedAtInterval = setInterval(() => {
      startedAtCounter += 1;
      startedAtOffset += 500;

      if(new Date().getTime() > 1609459200000) {
        parent.startedAt = (new Date().getTime() - startedAtOffset);
        clearInterval(startedAtInterval);
        console.log('[' + parent.connectionId + ']', 'Timestamp Obtained', startedAtCounter, startedAtOffset);
      } else {
        if(startedAtCounter >= 10) {
          clearInterval(startedAtInterval);
        }
      }
    }, 500);

    console.log('[' + parent.connectionId + ']', '[MQTT Local]', 'Connecting');

    localClient = mqtt.connect('mqtt://localhost');

    localClient.on('connect', () => {
      console.log('[' + parent.connectionId + ']', '[MQTT Local]', 'Event', 'Connect');

      localClient.subscribe(parent.hardwareType + '/' + parent.serialNumber + '/#');
      localClient.subscribe('coordinator/#');
    });

    localClient.on('message', function (topic, message) {
      console.log('[' + parent.connectionId + ']', '[MQTT Local]', 'Event', 'Message', topic, message.toString());

      if(parent.checkWhitelist(parent.publishWhitelist, topic)) {
        remoteClient.publish(topic, message);
        console.log('[' + parent.connectionId + ']', '[MQTT Local]', 'Republished from Local to Remote');
      } else {
        console.log('[' + parent.connectionId + ']', '[MQTT Local]', 'Message not whitelisted');
      }

      var pattern1 = new UrlPattern(':hardwareType/:serialNumber/' + parent.connectionId + '/disconnect');

      if(pattern1.match(topic)) {
        console.log('[' + parent.connectionId + ']', '[MQTT Local]', 'Initiating disconnection from remote');

        try {
          remoteClient.end(true);
        } catch(err) {
          console.error('[' + parent.connectionId + ']', '[MQTT Local]', 'Error initiating disconnection from remote', err);
        }
      }

      var pattern2 = new UrlPattern(':hardwareType/:serialNumber/' + parent.connectionId + '/connect');

      if(pattern2.match(topic)) {
        console.log('[' + parent.connectionId + ']', '[MQTT Local]', 'Initiating connection to remote');

        try {
          remoteClient.reconnect();
        } catch(err) {
          console.error('[' + parent.connectionId + ']', '[MQTT Local]', 'Error initiating connection to remote', err);
        }
      }
    });

    console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Connecting', this.mqttEndpoint, this.serialNumber);

    var options = {
      username: this.mqttUsername,
      password:  this.mqttPassword
    };

    if(this.mqttPort !== undefined && this.mqttPort !== null) {
      options.port = this.mqttPort;
    }

    remoteClient = mqtt.connect(this.mqttEndpoint, options)

    remoteClient.on('connect', function () {
      console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Event', 'Connect');

      remoteClient.subscribe(parent.hardwareType + '/' + parent.serialNumber + '/#');
      remoteClient.subscribe('coordinator/#');

      remoteClient.publish(parent.hardwareType + '/' + parent.serialNumber + '/register-device', JSON.stringify(parent.getDeviceRegistration()));
    })

    remoteClient.on('reconnect', () => {
      console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Event', 'Reconnect');
    });

    remoteClient.on('close', () => {
      console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Event', 'Close');
    });

    remoteClient.on('disconnect', () => {
      console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Event', 'Disconnect');
    });

    remoteClient.on('offline', () => {
      console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Event', 'Offline');
    });

    remoteClient.on('error', (error) => {
      console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Event', 'Error', error);
    });

    remoteClient.on('message', function (topic, message) {
      console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Event', 'Message', topic, message.toString());

      if(parent.checkWhitelist(parent.subscribeWhitelist, topic)) {
        localClient.publish(topic, message);
        console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Republishing from Remote to Local');
      } else {
        console.log('[' + parent.connectionId + ']', '[MQTT Remote]', 'Message not whitelisted');
      }

      var presencePattern = new UrlPattern(':hardwareType/:serialNumber/state/request(/:id)');

      if(presencePattern.match(topic)) {
        var params = presencePattern.match(topic);

        var topic = parent.hardwareType + '/' + parent.serialNumber + '/state/response';

        if(params.id !== undefined) {
          topic += '/' + params.id;
        }

        remoteClient.publish(topic, JSON.stringify({
          uptime: (parent.startedAt !== null ? (new Date().getTime() - parent.startedAt) : null),
          timestamp: new Date().getTime()
        }));
      }

      if(topic == 'coordinator/device-info/request') {
        remoteClient.publish(parent.hardwareType + '/' + parent.serialNumber + '/register-device', JSON.stringify(parent.getDeviceRegistration()));
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
