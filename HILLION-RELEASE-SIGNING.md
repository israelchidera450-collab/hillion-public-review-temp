# HILLION permanent Android release signing

The Android validation workflow deliberately signs its debug APK with a temporary CI-only key. That artifact is for build inspection only and must never be installed as an upgrade.

A production APK is built only when the manual Android workflow is run and all four repository Actions secrets below are configured:

- `HILLION_RELEASE_KEYSTORE_BASE64` — Base64-encoded permanent JKS/PKCS12 keystore.
- `HILLION_RELEASE_STORE_PASSWORD` — keystore password.
- `HILLION_RELEASE_KEY_ALIAS` — alias of the signing key.
- `HILLION_RELEASE_KEY_PASSWORD` — signing key password.

## Create the permanent key

Create the key on a trusted device, not in a public terminal or shared computer. Keep the keystore and passwords in at least two secure offline locations. Losing this key prevents future APK updates signed with the same application ID.

Example using Termux with OpenJDK installed (choose a strong password and keep it private):

```sh
keytool -genkeypair -v \
  -keystore "$HOME/hillion-release.jks" \
  -alias hillion-release \
  -keyalg RSA -keysize 4096 -validity 10000
```

Check the certificate fingerprint and record it somewhere safe:

```sh
keytool -list -v -keystore "$HOME/hillion-release.jks" -alias hillion-release
```

Encode the keystore for a GitHub Actions secret:

```sh
base64 -w 0 "$HOME/hillion-release.jks"
```

Copy the resulting single-line output directly into the GitHub secret value. Do not paste the keystore, its Base64 contents, or either password into a ChatGPT conversation, issue, commit, or source file.

## Add repository secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add the four names exactly as listed above. Store the Base64 output and passwords as secret values. Do not add them as ordinary repository variables.

## Build

Open **Actions → HILLION Android compile verification → Run workflow** and run it on the implementation branch. When all four secrets are present, the workflow builds, verifies, and archives `HILLION-ANDROID-RELEASE`. If any secret is missing or invalid, no production release artifact is created; the CI-only debug APK remains clearly labelled as not for upgrade.

## Installation safety

- The CI debug artifact is never an installable production upgrade.
- A release signed with a newly created key will not update an already-installed APK signed by a different certificate. Keep the existing working installation until a data/model migration and installation plan is ready.
- Uninstalling the old app can erase its private GGUF model and app data. Export and verify lesson backups first; the current encrypted local backup does not include the app-private GGUF model.
- Keep the permanent keystore for the lifetime of this app identity. Every future release must use the same key.
- The workflow verifies APK package metadata and signature validity. It does not replace testing on the Redmi device.
