#!/bin/bash

BASE_DIR="$(pwd)"


#!/bin/bash
# NOTE : Quote it else use array to avoid problems #
BASE_DIR="$(pwd)"
echo "Base Directory: ${BASE_DIR}"
package="*"
while getopts p: flag
do
    case "${flag}" in
        p) package=${OPTARG}.json;;
        *) ;;
    esac
done

PACKAGE_VERSION=$(deno eval --quiet 'import c from "./deno.json" with { type: "json" }; console.log(c.version);')
PACKAGES="${BASE_DIR}/docs/sdk-config/$package"
for f in $PACKAGES
do
  echo "Processing $f file..."
  # map file name to openapi generator conf file names
  filename=$(basename "$f" .json)
  # remove previous build
  rm -rf "${BASE_DIR}/docs/sdk/client/$filename/*"

  export TS_POST_PROCESS_FILE="/usr/local/bin/prettier --write"

  # Build the SDK's
  npx @openapitools/openapi-generator-cli generate  --skip-validate-spec -i "${BASE_DIR}/openapi.json" -g "$filename" \
      -o "${BASE_DIR}/docs/sdk/client/$filename" -c "$f" --git-host "github.com" \
    --git-repo-id "server-sdk-$filename" --git-user-id "dAppServer" --artifact-version "${PACKAGE_VERSION}" --group-id "dappserver" \
    -p packageVersion="${PACKAGE_VERSION}" --global-property "apiTests=true" --additional-properties=npmVersion="${PACKAGE_VERSION}",artifactVersion="${PACKAGE_VERSION}";

  # Push to git
#  (cp -f "${BASE_DIR}/build/ext/git_push.sh" "${BASE_DIR}/../tmp-build/client/$filename/git_push.sh" && chmod +x "${BASE_DIR}/../tmp-build/client/$filename/git_push.sh" &&
#  cd "${BASE_DIR}/../tmp-build/client/$filename" && /bin/sh "$BASE_DIR/../tmp-build/client/$filename"/git_push.sh snider sdk-gogetssl-"$filename")
done
#
#
#PACKAGE="${BASE_DIR}/../tmp-build/client/typescript-angular/api/*"
#
#  for file in $PACKAGE;
#  do
#      echo 'fixing' + $file
#      sed -i "s#localVarHeaders#headers#g" $file;
#  done
#
#PACKAGES="${BASE_DIR}/build/packages/$package"
#for f in $PACKAGES
#do
#  # Push to git
#  (cp -f "${BASE_DIR}/build/ext/git_push.sh" "${BASE_DIR}/../tmp-build/client/$filename/git_push.sh" && chmod +x "${BASE_DIR}/../tmp-build/client/$filename/git_push.sh" &&
#  cd "${BASE_DIR}/../tmp-build/client/$filename" && /bin/sh "$BASE_DIR/../tmp-build/client/$filename"/git_push.sh snider sdk-gogetssl-"$filename")
#done


echo "Yay! all done"
