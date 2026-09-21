# Third-party notices

`public/vendor/msgreader.js` is a browser bundle, built with `npm run build:vendor`, of these
packages. Each keeps its own license. The full license texts are in each package's `LICENSE` file
in `node_modules/`, and their copyright notices are kept in the bundle's trailing comments.

| Package | Version | License |
|---|---|---|
| [@kenjiuno/msgreader](https://github.com/HiraokaHyperTools/msgreader) | 1.28.0 | Apache-2.0 |
| [@kenjiuno/decompressrtf](https://github.com/HiraokaHyperTools/decompressrtf) | 0.1.4 | BSD-2-Clause |
| [buffer](https://github.com/feross/buffer) | 6.0.3 | MIT |
| [base64-js](https://github.com/beatgammit/base64-js) | 1.5.1 | MIT |
| [ieee754](https://github.com/feross/ieee754) | 1.2.1 | BSD-3-Clause |
| [iconv-lite](https://github.com/ashtuchkin/iconv-lite) | 0.6.3 | MIT |
| [safer-buffer](https://github.com/ChALkeR/safer-buffer) | 2.1.2 | MIT |
| [string_decoder](https://github.com/nodejs/string_decoder) | 1.3.0 | MIT |

The site also loads these at run time. They are not stored in this repository:

| Package | Loaded from | License |
|---|---|---|
| [@azure/msal-browser](https://github.com/AzureAD/microsoft-authentication-library-for-js) 5.22.0 | jsDelivr, only when someone signs in | MIT |
| Cloudflare Turnstile | challenges.cloudflare.com, only when sharing or reporting | Cloudflare terms |
