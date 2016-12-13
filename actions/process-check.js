/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var Cloudant = require('cloudant');
var async = require('async');
var fs = require('fs');
var gm = require('gm').subClass({
  imageMagick: true
});

/**
 * This action is triggered by a new check image added to a CouchDB database.
 *
 * 1. Fetch the image from the 'incoming-checks' database.
 * 2. Invoke the parse-image action to extract account number and routing number from the check image.
 * 3. Resize the image and store the resized image into the 'processed-checks' database with transaction details.
 *
 * @param   params._id                       The id of the inserted record in the Cloudant 'audit' database that triggered this action
 * @param   params.CLOUDANT_USERNAME         Cloudant username
 * @param   params.CLOUDANT_PASSWORD         Cloudant password
 * @param   params.CURRENT_NAMESPACE         The current namespace so we can call the OCR action by name
 * @return                                   Standard OpenWhisk promises
 */
function main(params) {

    // Configure database connections.
    console.log(params);
    var cloudant = new Cloudant({
      account:  params.CLOUDANT_USERNAME,
      password: params.CLOUDANT_PASSWORD
    });
    var incomingDb = cloudant.db.use('incoming-checks');
    var processedDb = cloudant.db.use('processed-checks');

    var tokens = params._id.split('^');
    var check = {};
    check._id = params._id;
    check.toAccount = tokens[0];
    check.amount = tokens[1];

    // Could also use promises to manage the sequence of async functions.
    async.waterfall([

      // Call the OCR action. Reads image and returns fromAccount, routingNumber.
      function (callback) {
        console.log('[process-check.main] Executing OCR parse of check');
        asyncCallOcrParseAction("/" + params.CURRENT_NAMESPACE + "/parse-image",
          params.CLOUDANT_USERNAME,
          params.CLOUDANT_PASSWORD,
          'incoming-checks',
          callback,
          check
        );
      },

      // Copy and resize the file to a smaller version.
      function (check, callback) {
        console.log("Creating resized image.");
        incomingDb.attachment.get(check._id, check._id).pipe(fs.createWriteStream('check.jpg'));
        gm('check.jpg').resize(150).write('small-check.jpg', function (err) {
          return callback(err);
        });
        return callback(null, check);
      },

      // Open file to memory and send it to the next function.
      function (check, callback) {
        console.log("Opening file");
        fs.readFile('small-check.jpg', function(err, data) {
          if (err) {
            console.log("Error reading file.");
            return callback(err);
          } else {
            console.log("Success reading file.");
            return callback(null, check, data);
          }
        });
      },

      // Insert data into the processed database.
      function (check, data, callback) {
        console.log('[process-check.main] Inserting into the processed database');
        console.log(check);

        processedDb.multipart.insert(
          {
            _id: check._id,
            fromAccount: check.fromAccount,
            routingNumber: check.routingNumber,
            toAccount: check.toAccount,
            amount: check.amount
          },
          [
            {
              name: check._id,
              data: data, content_type:
              'image/jpg'
            }
          ],
          function (err, body, head) {
            if (err) {
              console.log('[process-check.main] error: processedDb');
              console.log(err);
              return callback(err);
            } else {
              console.log('[process-check.main] success: processedDb');
              console.log(body);
              return callback(null);
            }
          }
        );
      },

    ],

      function (err, result) {
        if (err) {
          console.log("[KO]", err);
        } else {
          console.log("[OK]");
        }
        whisk.done(null, err);
      }
  );

  return whisk.async();
}

/**
 * This function provides a way to invoke other OpenWhisk actions directly and asynchronously
 *
 * @param   actionName    The id of the record in the Cloudant 'processed' database
 * @param   cloudantUser  Cloudant username (set once at action update time)
 * @param   cloudantPass  Cloudant password (set once at action update time)
 * @param   database      Cloudant database (set once at action update time)
 * @param   callback      Callback to return value to
 * @param   check         Value object holding check information
 * @return                The reference to a configured object storage instance
 */
function asyncCallOcrParseAction(actionName, cloudantUser, cloudantPass, database, callback, check) {
  console.log("Calling", actionName, "for", check._id);
  whisk.invoke({
    name: actionName,
    parameters: {
      CLOUDANT_USERNAME: cloudantUser,
      CLOUDANT_PASSWORD: cloudantPass,
      CLOUDANT_DATABASE: database,
      IMAGE_ID: check._id
    },
    blocking: true,
    next: function (err, activation) {
      if (err) {
        console.log(actionName, "[error]", error);
        return callback(err);
      } else {
        console.log(actionName, "[activation]", activation);
        check.fromAccount = activation.result.result.account;
        check.routingNumber = activation.result.result.routing;
        return callback(null, check);
      }
    }
  });
}
