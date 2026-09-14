#!/bin/bash
set -euo pipefail
FRAMEWORK_RELATIVE='../modules/on-device-youtube/vendor/python/Python.xcframework'
# Official BeeWare tooling packages and signs extension frameworks for iOS.
source "$PROJECT_DIR/$FRAMEWORK_RELATIVE/build/utils.sh"
install_python "$FRAMEWORK_RELATIVE"
mkdir -p "$CODESIGNING_FOLDER_PATH/md_python" "$CODESIGNING_FOLDER_PATH/md_packages" "$CODESIGNING_FOLDER_PATH/md_fixtures"
rsync -a --delete --exclude '__pycache__' --exclude '*.pyc' "$PROJECT_DIR/../modules/on-device-youtube/python/" "$CODESIGNING_FOLDER_PATH/md_python/"
rsync -a --delete --exclude '__pycache__' --exclude '*.pyc' "$PROJECT_DIR/../modules/on-device-youtube/vendor/packages/" "$CODESIGNING_FOLDER_PATH/md_packages/"
rsync -a --delete "$PROJECT_DIR/../modules/on-device-youtube/vendor/fixtures/" "$CODESIGNING_FOLDER_PATH/md_fixtures/"
mkdir -p "$CODESIGNING_FOLDER_PATH/ThirdPartyNotices"
cp "$PROJECT_DIR/../modules/on-device-youtube/vendor/quickjs/LICENSE" "$CODESIGNING_FOLDER_PATH/ThirdPartyNotices/QuickJS-NG.txt"
