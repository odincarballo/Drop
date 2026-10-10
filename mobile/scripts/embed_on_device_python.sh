#!/bin/bash
set -euo pipefail
FRAMEWORK_RELATIVE='../modules/on-device-youtube/vendor/python/Python.xcframework'
# Official BeeWare tooling packages and signs extension frameworks for iOS.
source "$PROJECT_DIR/$FRAMEWORK_RELATIVE/build/utils.sh"
install_python "$FRAMEWORK_RELATIVE"
mkdir -p "$CODESIGNING_FOLDER_PATH/md_python" "$CODESIGNING_FOLDER_PATH/md_packages"
rsync -a --delete --exclude '__pycache__' --exclude '*.pyc' "$PROJECT_DIR/../modules/on-device-youtube/python/" "$CODESIGNING_FOLDER_PATH/md_python/"
rsync -a --delete --exclude '__pycache__' --exclude '*.pyc' "$PROJECT_DIR/../modules/on-device-youtube/vendor/packages/" "$CODESIGNING_FOLDER_PATH/md_packages/"
mkdir -p "$CODESIGNING_FOLDER_PATH/ThirdPartyNotices"
cp "$PROJECT_DIR/../modules/on-device-youtube/vendor/quickjs/LICENSE" "$CODESIGNING_FOLDER_PATH/ThirdPartyNotices/QuickJS-NG.txt"
cp "$PROJECT_DIR/../modules/on-device-youtube/vendor/python/Python.xcframework/lib/python3.13/LICENSE.txt" "$CODESIGNING_FOLDER_PATH/ThirdPartyNotices/CPython.txt"
cp "$PROJECT_DIR/../../THIRD_PARTY_NOTICES.md" "$CODESIGNING_FOLDER_PATH/ThirdPartyNotices/Drop.md"
mkdir -p "$CODESIGNING_FOLDER_PATH/ThirdPartyNotices/NativePython"
rsync -a --delete "$PROJECT_DIR/../modules/on-device-youtube/notices/" "$CODESIGNING_FOLDER_PATH/ThirdPartyNotices/NativePython/"
pods_acknowledgements="$PROJECT_DIR/Pods/Target Support Files/Pods-${TARGET_NAME}/Pods-${TARGET_NAME}-acknowledgements.markdown"
if [[ ! -f "$pods_acknowledgements" ]]; then
  echo "Missing CocoaPods acknowledgements: $pods_acknowledgements" >&2
  exit 1
fi
cp "$pods_acknowledgements" "$CODESIGNING_FOLDER_PATH/ThirdPartyNotices/CocoaPods.md"
