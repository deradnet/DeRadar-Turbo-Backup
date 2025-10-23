# Dashboard Partials System

## Overview
This directory contains shared EJS partials used by both the admin and public dashboards. This ensures that both pages stay in sync when updates are made.

## File Structure

```
/src/views/partials/
├── README.md              # This file
├── head.ejs              # HTML head (meta, scripts, tailwind config)
├── styles.ejs            # All CSS styles and animations
└── dashboard-core.ejs    # Main dashboard body content (1861 lines)
```

## How It Works

### Before (Duplicate Code)
- `admin-dashboard-optimized.ejs` - 2846 lines
- `public-dashboard-readonly.ejs` - 2888 lines
- **Problem**: Changes had to be made twice, pages could drift apart

### After (Shared Components)
- `admin-dashboard-optimized-NEW.ejs` - 11 lines (uses partials)
- `public-dashboard-readonly-NEW.ejs` - 11 lines (uses partials)
- `partials/dashboard-core.ejs` - 1861 lines (shared by both)
- **Solution**: Update once, both pages change

## Usage

### Admin Dashboard
```ejs
<!DOCTYPE html>
<html lang="en">
<head>
    <%- include('partials/head', {pageTitle: 'DeRadar Node Dashboard'}) %>
    <%- include('partials/styles') %>
</head>
<body class="bg-dark-bg text-dark-text font-sans overflow-hidden" x-data="dashboard()" x-cloak>
    <%- include('partials/dashboard-core', {isAdmin: true}) %>
</body>
</html>
```

### Public Dashboard
```ejs
<!DOCTYPE html>
<html lang="en">
<head>
    <%- include('partials/head', {pageTitle: 'Public Dashboard - DeRadar Turbo'}) %>
    <%- include('partials/styles') %>
</head>
<body class="bg-dark-bg text-dark-text font-sans overflow-hidden" x-data="dashboard()" x-cloak>
    <%- include('partials/dashboard-core', {isAdmin: false}) %>
</body>
</html>
```

## Making Changes

### To Update the Dual Processing Train Visualization
**Edit**: `partials/dashboard-core.ejs`
**Result**: Both admin and public pages updated automatically

### To Update Styles/Animations
**Edit**: `partials/styles.ejs`
**Result**: Both pages get the new styles

### To Update Scripts or Tailwind Config
**Edit**: `partials/head.ejs`
**Result**: Both pages get the updates

### To Add Admin-Only Features
**Edit**: `partials/dashboard-core.ejs`
**Add**: Conditional logic using the `isAdmin` variable
```ejs
<% if (isAdmin) { %>
    <!-- Admin-only controls, buttons, sections -->
    <button>Admin Control Panel</button>
<% } %>
```

## Migration Steps

1. **Test the new files first** (files ending in -NEW.ejs)
2. **Once confirmed working**:
   ```bash
   mv admin-dashboard-optimized.ejs admin-dashboard-optimized-OLD.ejs
   mv admin-dashboard-optimized-NEW.ejs admin-dashboard-optimized.ejs

   mv public-dashboard-readonly.ejs public-dashboard-readonly-OLD.ejs
   mv public-dashboard-readonly-NEW.ejs public-dashboard-readonly.ejs
   ```
3. **Keep the -OLD files as backup** until you're confident
4. **Delete -OLD files** when everything is working

## Benefits

✅ **Single Source of Truth**: Update dashboard once, both pages change
✅ **Consistency**: Admin and public pages always identical
✅ **Maintainability**: Easier to find and fix bugs
✅ **DRY Principle**: Don't Repeat Yourself
✅ **Faster Development**: Make changes once instead of twice

## Partials Breakdown

### head.ejs (47 lines)
- Character encoding and viewport
- Dynamic page title via `pageTitle` variable
- Tailwind CSS CDN
- Alpine.js CDN
- Socket.io client
- Lucide icons
- Three.js for 3D graphics
- GSAP for animations
- Tailwind configuration (colors, dark mode)
- Google Fonts (Inter)

### styles.ejs (933 lines)
- Icon animations (pulse, spin, bounce, glow)
- Wagon components (waiting, slot, success, processing)
- Wagon animations (enter, exit, new-arrival, scanner-beam, data-flow)
- Train container and connectors
- Progress bars and rings
- Power switch animation
- 3D orbital animations
- Metric cards
- Tooltips
- Activity log scrollbars
- Engine canvas overlays
- Responsive breakpoints
- All @keyframes animations

### dashboard-core.ejs (1861 lines)
- Complete Alpine.js dashboard application
- Top navigation and stats grid
- Dual Processing Train visualization:
  - Engine with canvas animation
  - Standard pipeline (blue)
  - Encrypted pipeline (purple)
  - Shared success line
- Metrics cards (slots, queue, uploads)
- Activity log
- System information
- All Alpine.js data, methods, watchers
- Socket.io connection logic
- Stats fetching and animation
- Engine canvas initialization
- All wagon calculation logic

## Variables Available in Partials

### head.ejs
- `pageTitle` (string): The browser tab title

### dashboard-core.ejs
- `isAdmin` (boolean): true for admin dashboard, false for public

## Future Improvements

If you want to break down `dashboard-core.ejs` further, you could extract:
- `train-visualization.ejs` - Just the dual processing train
- `stats-grid.ejs` - The top stats cards
- `alpine-logic.ejs` - The JavaScript/Alpine.js code
- `engine-canvas.ejs` - The canvas animation script

But for now, having one shared core is much better than two 2800-line duplicate files!

## Notes

- The `-NEW` files are temporary during migration
- All Alpine.js reactivity is preserved
- No functionality was changed, only structure
- CSS and JavaScript work exactly as before
- Both pages will look and behave identically
