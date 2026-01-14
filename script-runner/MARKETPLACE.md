# Publishing RunMate to VS Code Marketplace

This guide will help you publish RunMate to the official VS Code Marketplace.

## Prerequisites

1. **Node.js** – Make sure you have Node.js installed
2. **Git** – For version control
3. **GitHub Account** – To host the repository (recommended)
4. **VS Code Marketplace Account** – Create one at https://marketplace.visualstudio.com

## Step 1: Prepare Your Publisher Account

1. Go to https://marketplace.visualstudio.com
2. Sign in with your Microsoft account
3. Create a publisher (e.g., "SanekxArcs" or your username)
4. You'll need a Personal Access Token (PAT) for publishing

### Create a Personal Access Token

1. Go to https://dev.azure.com
2. Create a new organization or use an existing one
3. Go to **User Settings** → **Personal Access Tokens**
4. Click **New Token** with these settings:
   - Name: `vscode-extension-publisher`
   - Organization: Your organization
   - Expiration: Custom (set to a year or longer)
   - Scopes: `Marketplace: Publish`
5. Copy the token (you'll need it soon)

## Step 2: Install and Configure VSCE

VSCE (Visual Studio Code Extensions) is the official CLI tool for publishing.

```bash
npm install -g vsce
```

## Step 3: Add Icon & Screenshots

### Icon
- **File:** `icon.png` (already referenced in `package.json`)
- **Size:** 128x128 pixels
- **Format:** PNG
- **Location:** Root of the extension folder
- **What to include:** Simple, recognizable icon representing script running (gear, play button, terminal, etc.)

### Screenshot (Optional but Recommended)
- **File:** `screenshot.png`
- **Size:** 1920x1080 or 1280x720 pixels
- **Format:** PNG
- **Location:** Root folder or `screenshots/` directory
- **What to show:** 
  - Status bar with script buttons
  - Quick menu with scripts
  - Terminal output

## Step 4: Create .vscodeignore

This file tells VSCE what to exclude from the published package:

```
.git
.gitignore
.vscode
node_modules
*.vsix
README.md
MARKETPLACE.md
screenshot.png
.prettierrc
.eslintrc
```

File location: `script-runner/.vscodeignore`

## Step 5: Package the Extension

Test packaging locally:

```bash
cd script-runner
vsce package
```

This creates a `.vsix` file that you can manually test before publishing.

## Step 6: Publish to Marketplace

### First Time Publishing

```bash
cd script-runner
vsce publish --pat <your-token>
```

Replace `<your-token>` with your Personal Access Token from Step 1.

### For Future Updates

```bash
# Update version in package.json
# Then publish
vsce publish patch    # for 0.0.1 → 0.0.2
vsce publish minor    # for 0.0.x → 0.1.0
vsce publish major    # for 0.x.x → 1.0.0
```

Or specify the token:
```bash
vsce publish patch --pat <your-token>
```

## Step 7: Verify Publication

1. Visit https://marketplace.visualstudio.com/items?itemName=SanekxArcs.runmate
2. Check that everything looks correct
3. Install from VS Code to test

## Best Practices for Your Extension Page

### Title & Description
- ✅ Clear, descriptive title: "RunMate"
- ✅ Compelling description in `package.json`
- ✅ Keywords that users will search for

### Documentation
- ✅ Comprehensive README with examples
- ✅ Feature highlights with emojis
- ✅ Configuration options clearly documented
- ✅ Troubleshooting section

### Assets
- ✅ Professional icon (128x128)
- ✅ Screenshot showing the extension in action
- ✅ Repository link (GitHub)
- ✅ Bug tracker link

### Quality
- ✅ Working code without errors
- ✅ Proper error messages
- ✅ Reasonable default configuration

## Update Checklist

Before each release:

- [ ] Update version in `package.json`
- [ ] Update `CHANGELOG.md` (if you have one)
- [ ] Test extension locally (`F5` to debug)
- [ ] Run `npm test` (if tests exist)
- [ ] Review README for accuracy
- [ ] Update icon/screenshots if needed
- [ ] Commit changes to git
- [ ] Publish with `vsce publish`

## Troubleshooting

### "vsce publish" fails with "Unauthorized"
- Double-check your Personal Access Token
- Ensure token hasn't expired
- Make sure the organization matches in the publisher field

### Version already exists error
- Update the version in `package.json` before publishing
- Each release needs a new version

### Icon not showing in Marketplace
- Ensure `icon.png` is exactly 128x128 pixels
- Verify it's in the root of the extension folder
- Check that `icon.png` is referenced in `package.json`

### Extension won't activate
- Check `activationEvents` in `package.json`
- Ensure you have a `package.json` in your workspace for testing

## Resources

- [VS Code Extension Publishing Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VSCE Documentation](https://github.com/microsoft/vscode-vsce)
- [Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)

## Additional Marketplace Considerations

### Category Best Practices
RunMate uses:
- `"Other"` – Primary category
- `"Productivity"` – Secondary category (optional)

### Extension Repository
Make your GitHub repository public and link it in `package.json`:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/SanekxArcs/runmate"
}
```

### Licensing
- Include a `LICENSE` file in your repository (MIT, Apache 2.0, etc.)
- Reference it in `package.json` with `"license": "MIT"`

---

**You're all set!** RunMate is now ready for the VS Code Marketplace. 🚀
