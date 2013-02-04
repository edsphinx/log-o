var assert = require('assert');

var db = null;

module.exports.init = function (mongodb, username, password) {
  mongodb.open(function (err, data) {
    if (data) {
      data.authenticate(username, password, function (err2, data2) {
        if (err2) console.log(err2);
        db = mongodb;
        mongodb.collection('users', function (err, collection) {
          collection.ensureIndex({email: 1}, {unique: true}, function (err, result) {
            assert.equal(null, err);
          });
        });
        mongodb.collection('messages', function (err, collection) {
          collection.ensureIndex({time: -1, timestamp: -1}, function (err, result) {
            assert.equal(null, err);
          });
          collection.ensureIndex({keywords: 1, host: 1}, function (err, result) {
            assert.equal(null, err);
          });
          collection.ensureIndex({host: 1, severity: 1}, function (err, result) {
            assert.equal(null, err);
          });
          collection.ensureIndex({host: 1, facility: 1}, function (err, result) {
            assert.equal(null, err);
          });
        });
      });
    } else {
      console.log(err);
    }
  });
};

module.exports.getUserByToken = function (token, callback) {
  findOneDocument('users', {token: token}, function (user) {
    callback(user);
  });
};

module.exports.getUserByEmail = function (email, callback) {
  findOneDocument('users', {email: email}, function (user) {
    callback(user);
  });
};

module.exports.getUserByEmailAndPassword = function (email, password, callback) {
  findOneDocument('users', {email: email, password: password}, function (user) {
    callback(user);
  });
};

module.exports.getUsers = function (callback) {
  findDocuments('users', {}, function (users) {
    callback(users);
  });
};

module.exports.getMessages = function (queryString, callback) {
  db.collection('messages', function (err, collection) {
    var args = null;
    try {
      args = JSON.parse(queryString['q']);
    } catch (e) {
      args = {};
    }

    var query = collection.find(args).sort({time: -1, timestamp: -1});
    var skip = pop(queryString, 'skip');
    var limit = pop(queryString, 'limit');

    if (skip) query = query.skip(parseInt(skip));
    if (limit) {
      query = query.limit(parseInt(limit));
    } else {
      query = query.limit(100);
    }

    var messages = [];
    query.each(function (err, message) {
      if (!err && message) {
        messages.push(message); // This kind of sucks. In order to reverse the Cursor we have to load it all in memory.
      } else {
        callback(messages);
      }
    });
  });
};

module.exports.saveMessage = function (message, callback) {
  saveDocument('messages', message, function(err, message) {
    if (err){
      console.log('Could not save message:', err);
    }

    if (!callback) {
      throw new Error("Callback function is required for saveMessage!");
    }
    callback(message);
  });
};

module.exports.getLastMessage = function (callback) {
  db.collection('messages', function (err, collection) {
    collection.find({}, {'hash': 1}).sort({_id: -1}).limit(1).toArray(function (err, last_message) {
      if (!err && last_message) {
        callback(last_message);
      } else {
        console.log('Err', err);
        callback();
      }
    });
  });
};

module.exports.saveUser = function (user, callback) {
  saveDocument('users', user, function(err, user) {
    if (!callback) {
      throw new Error("Callback function is required for saveUser!");
    }
    callback(user);
  });
};

module.exports.saveAlert = function (alert, callback) {
  saveDocument('alerts', alert, function(err, alert) {
    if (!callback) {
      throw new Error("Callback function is required for saveAlert!");
    }
    callback(alert);
  });
};

module.exports.getActiveAlerts = function (callback) {
  db.collection('alerts', function (err, collection) {
    var alerts = [];
    collection.find({enable: true}).sort({email: 1}).toArray(function (err, alerts) {
      if (err) {
        console.log(err);
        return;
      }
      callback(alerts);
    });
  });
};

function findOneDocument(collectionName, args, callback) {
  db.collection(collectionName, function (err, collection) {
    collection.findOne(args, function (err, entity) {
      if (err) {
        console.log('Could not find document: ' + args, err);
        callback(null);
      } else {
        callback(entity);
      }
    });
  });
}

function findDocuments(collectionName, args, callback) {
  db.collection(collectionName, function (err, collection) {
    var entities = [];
    collection.find(args).each(function (err, entity) {
      if (!err && entity) {
        entities.push(entity);
      } else {
        callback(entities);
      }
    });
  });
}

function saveDocument(collectionName, document, callback) {
  db.collection(collectionName, function (err, collection) {
    collection.save(document, {safe: true}, function (err, entity) {
      if (entity == 1){
        callback(err, document);
      } else {
        callback(err, entity);
      }
    });
  });
}

function pop(dictionary, key){
	var e = dictionary[key];
	delete dictionary[key];
	return e;
}

