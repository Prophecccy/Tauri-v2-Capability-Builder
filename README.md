# Tauri v2 Capability Builder

A highly polished, interactive, self-contained single-file developer utility designed to build, validate, and preview security permissions configuration files for Tauri v2.

It runs as a hydrated React Island embedded in an Astro static site at the production domain [https://tauri-capability-builder.prophecccy.xyz](https://tauri-capability-builder.prophecccy.xyz).

---

## 🚀 Architecture & Technical Stack

- **Bedrock (Astro SSG)**: Pre-compiled zero-JS static HTML/CSS structure for maximum page speed.
- **Form Engine (React Island)**: Direct DOM hydration via Astro's `client:load` for reactive capability form rendering.
- **Style Tokens (Tailwind CSS v4)**: Tailwind CSS v4 Vite integration for styling using high-performance CSS variable configurations.
- **Custom Code Playground**: A custom regex-based parser and colorizer designed to token-highlight JSON and TOML output instantaneously without dragging down bundle performance with heavy libraries.

---

## 🛠️ State Schema Specification

The state structure mimics the Tauri v2 capability configuration schema:

```typescript
interface FileSystemRule {
  id: string;
  type: 'allow' | 'deny';
  path: string; // e.g. "$APP_DATA/**/*"
}

interface ShellRule {
  id: string;
  name: string; // e.g. "binaries/my-sidecar"
  sidecar: boolean;
  args: boolean;
}

interface ScopeState {
  fs: FileSystemRule[];
  shell: ShellRule[];
}

interface BuilderState {
  identifier: string;      // Lowercase kebab-case validation
  description: string;     // Freeform description
  windows: string[];       // Target window list (default: ["main"])
  platforms: string[];     // Targeted platform list (macOS, windows, linux, android, iOS)
  permissions: string[];   // Active permission identifiers
  scope: ScopeState;       // Custom scopes associated with permissions
}
```

---

## 🔒 Security Validators (Anti-Vulnerability Checks)

The inline visual validation panel dynamically checks configurations for critical issues:
1. **Identifier format**: Warns if the identifier contains spaces, uppercase letters, or non-kebab characters.
2. **Recursive HOME directories**: Flags scopes that recursively allow `$HOME/**/*`, preventing host file leakage.
3. **Scoped mismatch**: Flags when permissions that require scopes are checked (e.g. `fs:allow-read` or `shell:allow-execute`), but no scope rules are added.
4. **Empty permissions list**: Warns if the capability lacks permissions (rendering it ineffective).

---

## 🧞 Dev Commands

| Command | Action |
| :--- | :--- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the local development server |
| `npm run build` | Compile the static production site to `./dist/` |
| `npm run preview` | Preview the compiled build locally |
