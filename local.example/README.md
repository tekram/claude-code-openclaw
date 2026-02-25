# local/ — Personal Private Extensions

The `local/` directory is gitignored and intended for personal, private API routes and components that you don't want to open source.

## Example: Adding a Private API Route

Add files following Next.js App Router conventions:

```
local/
├── app/
│   └── api/
│       └── my-private-route/
│           └── route.ts
└── components/
    └── MyPrivatePanel.tsx
```

However, Next.js App Router only scans `src/app/` by default. To load routes from `local/`, you have two options:

### Option 1: Symlink (Recommended)

```bash
cd src/app/api
ln -s ../../../local/app/api/my-private-route my-private-route
```

### Option 2: Manual import in page.tsx

Conditionally import local components:

```tsx
// In src/app/page.tsx
let LocalPanel: React.ComponentType | null = null;
try {
  LocalPanel = require('../../local/components/MyPrivatePanel').MyPrivatePanel;
} catch {}
```

## Example: LinkedIn Integration

Place your LinkedIn routes in `local/app/api/linkedin/` and symlink them into `src/app/api/linkedin/`.
