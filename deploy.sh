#!/bin/bash
#
# Copyright 2016 IBM Corp. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the “License”);
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#  https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an “AS IS” BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Load configuration variables
source local.env

# Capture the namespace where actions will be created
WSK='wsk' # Set if not in your $PATH
CURRENT_NAMESPACE=`$WSK property get --namespace | sed -n -e 's/^whisk namespace//p' | tr -d '\t '`
echo "Current namespace is $CURRENT_NAMESPACE."

function install() {
  echo "Binding package"
  $WSK package bind /whisk.system/cloudant checks \
  -p username "$CLOUDANT_USER" \
  -p password "$CLOUDANT_PASS" \
  -p host "$CLOUDANT_USER.cloudant.com"

  echo "Creating triggers"
  $WSK trigger create new-check-deposit \
    --feed /$CURRENT_NAMESPACE/checks/changes \
    --param dbname "incoming-checks" \
    --param includeDocs true

  echo "Creating actions"
  $WSK action create process-check actions/process-checks.js \
    -p CLOUDANT_USER "$CLOUDANT_USER" \
    -p CLOUDANT_PASS "$CLOUDANT_PASS" \
    -p CURRENT_NAMESPACE "$CURRENT_NAMESPACE"
  $WSK action create --docker parse-image krook/parse-image

  echo "Enabling rule"
  $WSK rule create process-check new-check-deposit process-check
}

function uninstall() {
  $WSK rule disable invoke-periodically
  $WSK rule delete invoke-periodically
  $WSK trigger delete every-20-seconds
  $WSK action delete handler
}

function showenv() {
  echo CLOUDANT_INSTANCE=$CLOUDANT_INSTANCE
  echo CLOUDANT_USER=$CLOUDANT_USER
  echo CLOUDANT_PASS=$CLOUDANT_PASS
}

case "$1" in
"--install" )
install
;;
"--uninstall" )
uninstall
;;
"--env" )
showenv
;;
* )
usage
;;
esac
