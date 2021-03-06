var db = require('../db.js')
    , services = require('../services')
    , password = require('password')
    , crypto = require('crypto')
    , bcrypt = require('bcrypt');

function auth(req, res) {
  services.utils.parsePost(req, res, function () {
    db.getUserByEmail(res.post['email'], function (user) {

      if (!user) {
        services.syslog.sendMessage('Auth Failed (User Not Found): ' + res.post['email'] + ' IP: ' + req.connection.remoteAddress);
        services.utils.writeResponseMessage(res, 401, 'unauthorized');
        return;
      }

      if (!user.active) {
        services.syslog.sendMessage('Auth Failed (User Not Active): ' + user.email + ' IP: ' + req.connection.remoteAddress);
        services.utils.writeResponseMessage(res, 401, 'unauthorized');
        return;
      }

      bcrypt.compare(res.post['password'], user.password, function (err, result) {

        if (!result) {
          services.syslog.sendMessage('Auth Failed (Invalid Password): ' + res.post['email'] + ' IP: ' + req.connection.remoteAddress);
          services.utils.writeResponseMessage(res, 401, 'unauthorized');
          return;
        }

        user.token = null; //Erase token to ensure a new token is set.
        services.utils.setAuthToken(req, res, user);
        db.saveUser(user, function (user) {
          if (user.forcePasswordChange) {
            services.syslog.sendMessage('Auth (Force Password Change): ' + res.post['email'] + ' IP: ' + req.connection.remoteAddress);
            services.utils.writeResponseMessage(res, 200, 'force_password_change');
          } else {
            services.syslog.sendMessage('Auth: ' + res.post['email'] + ' IP: ' + req.connection.remoteAddress);
            services.utils.writeResponseMessage(res, 200, 'success');
          }
        });
      });
    });
  });
}

function add(req, res) {
  services.utils.parsePost(req, res, function () {
    services.utils.isAuth(req, res, 'USER_ADD', function (authUser) {

      //TODO: check perms
      var emailAddress = res.post['email'];
      if (!services.email.isValidEmail(emailAddress)) {
        services.syslog.sendMessage('User Add Failed (Invalid Email): ' + res.post['email'] + ' by: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
        services.utils.writeResponseMessage(res, 400, 'invalid_email');
        return;
      }

      var clearPassword = password(3);
      bcrypt.genSalt(10, function (err, salt) {
        bcrypt.hash(clearPassword, salt, function (err, hashedPassword) {
          db.saveUser({email: emailAddress, password: hashedPassword, forcePasswordChange: true, active: true, permissions: ['SEARCH']}, function (newUser) {
            services.syslog.sendMessage('User Add: ' + res.post['email'] + ' by: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
            services.email.sendWelcome(newUser.email, clearPassword);
            services.utils.writeResponseMessage(res, 200, 'success');
          });
        });
      });
    });
  });
}

/*
 * Adds an admin user if no other users exist.
 */
//TODO: Not really a route.
function addAdmin() {
  db.getUsers(function (users) {
    if (!users || users.length > 0) {
      return;
    }

    bcrypt.genSalt(10, function (err, salt) {
      bcrypt.hash('admin', salt, function (err, hashedPassword) {
        db.saveUser({email: 'admin', password: hashedPassword, forcePasswordChange: true, active: true, permissions: [
          'USER_ADD',
          'USER_LIST',
          'USER_EDIT',
          'USER_RESET',
          'ALERT_ADD',
          'ALERT_LIST',
          'ALERT_EDIT',
          'SEARCH',
          'TAIL']}, function (newUser) {
          services.syslog.sendMessage('User Add: admin');
        });
      });
    });
  });
}

function list(req, res) {
  services.utils.isAuth(req, res, 'USER_LIST', function (authUser) {
    db.getUsers(function (users) {
      services.syslog.sendMessage('User List: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
      if (!users) {
        return;
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify(users));
      res.end();
    });
  });
}

function edit(req, res) {
  services.utils.parsePost(req, res, function () {
    services.utils.isAuth(req, res, 'USER_EDIT', function (authUser) {
      var userParams = {email: res.post['email'], active: !!(res.post['active'] === 'true'), permissions: res.post['permissions']};

      db.getUserByEmail(userParams.email, function (user) {
        if (!user) {
          services.syslog.sendMessage('User Edit Failed (user_does_not_exist): ' + res.post['email'] + ' by: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
          services.utils.writeResponseMessage(res, 404, 'user_does_not_exist');
          return;
        }

        for (var key in userParams) {
          user[key] = userParams[key];
        }
        db.saveUser(user, function (user) {
          services.syslog.sendMessage('User Edit: ' + user.email + ' by: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
          services.utils.writeResponseMessage(res, 200, 'success');
        });
      });
    });
  });
}

function reset(req, res) {
  services.utils.parsePost(req, res, function () {
    services.utils.isAuth(req, res, function (authUser) {
      db.getUserByEmail(res.post['email'], function (resetUser) {
        if (!resetUser) {
          services.syslog.sendMessage('User Reset Failed (User Not Found): ' + res.post['email'] + ' by: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
          services.utils.writeResponseMessage(res, 404, 'user_not_found');
          return;
        }

        var clearPassword = password(3);
        bcrypt.genSalt(10, function (err, salt) {
          bcrypt.hash(clearPassword, salt, function (err, hashedPassword) {
            services.email.sendReset(resetUser.email, authUser.email, clearPassword);
            resetUser.forcePasswordChange = true;
            resetUser.password = hashedPassword;
            db.saveUser(resetUser, function (user) {
              if (user) {
                services.syslog.sendMessage('User Reset: ' + user.email + ' by: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
                services.utils.writeResponseMessage(res, 200, 'success');
              } else {
                services.syslog.sendMessage('User Reset Failed (Could Not Save User): ' + resetUser.email + ' by: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
                services.utils.writeResponseMessage(res, 500, 'could_not_save_user');
              }
            });
          });
        });
      });
    });
  });
}

function changePassword(req, res) {
  services.utils.parsePost(req, res, function () {
    services.utils.isAuth(req, res, function (authUser) {

      if (!res.post['newPassword']) {
        services.syslog.sendMessage('User Change Password (Password Required): ' + authUser.email + ' by: ' + authUser.email + ' by: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
        services.utils.writeResponseMessage(res, 400, 'password_required');
        return;
      }

      comparePriorPasswords(authUser, res.post['newPassword'], function (match) {
        if (match) {
          services.utils.writeResponseMessage(res, 400, 'password_matches_historical');
          return;
        }

        bcrypt.genSalt(10, function (err, salt) {
          bcrypt.hash(res.post['newPassword'], salt, function (err, hashedPassword) {
            authUser.password = hashedPassword;
            authUser.forcePasswordChange = false;
            services.syslog.sendMessage('User Change Password: ' + authUser.email + ' IP: ' + req.connection.remoteAddress);
            db.saveUser(authUser, function (user) {
              if (user) {
                db.savePriorPassword(authUser, function () {
                  services.utils.writeResponseMessage(res, 200, 'success');
                });
              } else {
                services.utils.writeResponseMessage(res, 500, 'could_not_change_password');
              }
            });
          });
        });
      });
    });
  });
}

function logout(req, res) {
  services.utils.isAuth(req, res, function (user) {
    //Set auth token but don't send it back via the cookie
    user.token = crypto.randomBytes(Math.ceil(256)).toString('base64');
    services.syslog.sendMessage('Logout: ' + user.email + ' IP: ' + req.connection.remoteAddress);
    db.saveUser(user, function (user) {
      if (user) {
        services.utils.writeResponseMessage(res, 200, 'success');
      } else {
        services.utils.writeResponseMessage(res, 500, 'could_not_logout');
      }
    });
  });
}

function comparePriorPasswords(authUser, newPassword, callback) {
  db.getPriorPasswords(authUser, function (passwords) {
    for (var i in passwords) {
			if(bcrypt.compareSync(newPassword, passwords[i])){
				callback(true);
				return;
			}
    }
		callback(false);
  });
}

module.exports = {
  auth: auth,
  add: add,
  addAdmin: addAdmin,
  list: list,
  edit: edit,
  reset: reset,
  changePassword: changePassword,
  logout: logout
};
