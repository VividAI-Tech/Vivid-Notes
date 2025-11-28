---
description: How to publish the VividAI extension to the Chrome Web Store
---

# Publish to Chrome Web Store

Follow these steps to publish your extension to the Chrome Web Store.

## 1. Prerequisites

-   **Google Account**: You need a Google account.
-   **Developer Account**: Register as a Chrome Web Store Developer [here](https://chrome.google.com/webstore/dev/register). There is a one-time registration fee of **$5**.

## 2. Prepare the Extension

1.  **Update Version**: Ensure the `version` in `manifest.json` is correct (e.g., `1.0.0`).
2.  **Test Locally**: Verify everything works in `chrome://extensions` (Load unpacked).
3.  **Create Zip File**:
    -   Go to the root directory of your project (`flyrec`).
    -   Select all files and folders **EXCEPT** `.git`, `.gemini`, `node_modules` (if any), and `DS_Store`.
    -   Compress them into a single `vividai.zip` file.
    -   *Command Line Tip*:
        ```bash
        zip -r vividai.zip . -x "*.git*" "*.gemini*" "*.DS_Store*"
        ```

## 3. Upload to Dashboard

1.  Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/dev/dashboard).
2.  Click **+ New Item**.
3.  Upload your `vividai.zip` file.

## 4. Store Listing

Fill out the required information:

-   **Description**: A detailed description of what the extension does. You can use the content from your `README.md`.
-   **Category**: Choose "Productivity" or "Workflow".
-   **Language**: English.
-   **Graphic Assets**:
    -   **Icon**: 128x128 px (Use `icons/icon128.png`).
    -   **Screenshots**: At least one 1280x800 px or 640x400 px screenshot.
    -   **Marquee Tile**: 440x280 px (You can use a cropped version of `assets/hero-banner.png`).

## 5. Privacy Practices

This is critical. You must disclose how you handle user data.

-   **Permissions**:
    -   `storage`: To save settings locally.
    -   `activeTab`: To interact with the current meeting tab.
    -   `tabCapture`: To capture audio for transcription.
    -   `scripting`: To inject the meeting detector.
-   **Data Usage**:
    -   Check "No" for "Do you sell user data?".
    -   Check "No" for "Do you use data for lending/credit?".
    -   Explain that data (API keys, transcripts) is stored **locally** and sent directly to the AI provider (OpenAI/etc) without passing through your servers.

## 6. Submit for Review

1.  Click **Submit for Review**.
2.  The review process usually takes **24-48 hours**, but can take longer for new accounts.

## 7. Updates

To update your extension later:
1.  Increment `version` in `manifest.json` (e.g., `1.0.1`).
2.  Zip the files again.
3.  Go to Dashboard > Your Item > **Package** > **Upload new package**.
