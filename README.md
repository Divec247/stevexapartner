# STEVEXA Partners

A free, private app with **three different views**, built to the governance pack (section 15 split).

| | IP Owner | Partner (stakeholder) | Business developer |
|---|---|---|---|
| Creates the other two kinds of account | **Yes, only the IP Owner** | No | No |
| Registers schools | For any business developer | No | Own schools |
| Records payments, voids, marks payouts | **Yes** | No | No |
| Sees everyone's money and the audit trail | Yes | No | No |
| Sees the split table and own share, payment by payment | (Overview) | **Yes** | No |
| Sees what a school paid | Yes | Yes (needed to check the maths) | **Never**; only own commission |
| Sees school contact details | Yes | Never | Own schools only |

**The split** (on money actually collected): IP Owner 50% . Business developer up to 10% (new-customer payments only) . Remaining pool 40%, shared by the partners by the percentage you give each (for example DE-TECHPATHSOL 50, Mr. Peter 20, Engr. Julius 20, Legal Adviser 10 of the pool). On a N20,000,000 payment this gives exactly the table in your pack. Percentages are frozen on each payment when you record it.

## How it is hosted (all free)

* **Backend**: `backend/Code.gs` in Google Apps Script, with a Google Sheet as the database (same technology as your Result Hub, but a **separate** project and sheet, so money data is never mixed with school data).
* **Web page**: the `docs` folder, published by GitHub Pages.
* GitHub itself cannot run server programs, which is why the old Flask portal could not go there.

## Set-up (about 15 minutes)

1. **Google Sheet**: create a new Google Sheet named *STEVEXA Partners database*. Open **Extensions -> Apps Script**, delete the sample code and paste all of `backend/Code.gs`. Save.
2. **Owner details**: Project Settings (gear) -> *Script properties* -> add three: `OWNER_NAME`, `OWNER_EMAIL`, `OWNER_PASSWORD` (10+ characters, upper and lower case, a number).
3. In the editor choose the function **setup** and press Run (accept the permissions). Then choose **setupOwner** and Run. The password property is deleted automatically.
4. **Deploy -> New deployment -> Web app**: *Execute as:* **Me**, *Who has access:* **Anyone**. Copy the URL that ends in `/exec`.
5. Open `docs/config.js` and paste that URL between the quotes.
6. **GitHub**: create a repository, upload this folder, then *Settings -> Pages -> Deploy from a branch -> main, folder /docs*. Your app is at `https://<you>.github.io/<repo>/`.
7. Sign in as the owner, open **People** and register the business developer(s) and the partners. Each gets a temporary password shown once and must choose their own.

Whenever you change `Code.gs`, use **Deploy -> Manage deployments -> edit -> New version** (keep the same URL).

## Android app (APK) built by GitHub

The same `docs` page is also wrapped as an Android app (Capacitor). GitHub builds it for you; you install nothing on your computer.

1. Finish set-up steps 1 to 5 above (the `/exec` URL **must** be in `docs/config.js` before building).
2. Create a GitHub repository (private is fine for the APK) and upload **everything in this folder**, including the hidden `.github` folder.
3. Open the **Actions** tab -> *Build Android APK*. It runs by itself on every push to `main`, or press **Run workflow**. It takes about 5 to 8 minutes.
4. Open the finished run, scroll to **Artifacts**, download **STEVEXA-Partners-apk**, unzip it to get `app-debug.apk`.
5. Send the APK to the phone, open it, and allow *Install unknown apps* when Android asks.

If you change anything in `docs/`, push again and download the new APK. The app ships with its own copy of the pages, so it does not need GitHub Pages. Changes to `Code.gs` need no new APK (they go live through *New version* in Apps Script).

The splash screen is `docs/splash.jpg` (shown for about 2 seconds when the app opens) and `splash-src/` (shown by Android while the app starts). To change it, replace those files; the app icon is the logo mark in `android-res/`.

This is a debug-signed APK: fine for your own team. Publishing on Google Play needs a release-signed build, which can be added later.

## Things to know

* **Register the partners before recording the first payment.** A partner's share is created when a payment is recorded; earlier payments are not re-split.
* Partner shares of the pool must add up to 100%; the Overview warns you if they do not.
* A payment marked as *not a new customer* (renewal) gives the business developer nothing, and that 10% shows as **Unallocated** for you to decide on. The governance pack does not say where it goes, so the app does not guess.
* Business developer rate is capped at 10% so the three parts can never exceed 100%.
* A payment cannot be voided once any of its shares was marked paid out.
* By default partners can see each other's lines (as in your table). To show each partner only their own line plus one "other partners" line, add the Script property `PARTNERS_SEE_EACH_OTHER` = `FALSE`.
* Keep the Google Sheet private: anyone who can open it can read all the data. Share it with nobody.
* Protection of a registered school lasts 90 days, change `PROTECTION_DAYS` in `Code.gs`.
* This is a working tool, not legal advice; the percentages must match what counsel finalises.

## Tests

`node tests/test_backend.js` (23 checks: the split, who may do what, what each view can see). `node tests/ui_smoke.js` drives the real page in Chromium (needs Playwright).
