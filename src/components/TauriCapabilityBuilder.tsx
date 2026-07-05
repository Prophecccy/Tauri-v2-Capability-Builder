import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Terminal,
  ShieldAlert,
  Copy,
  Check,
  Download,
  Upload,
  Plus,
  Trash2,
  HelpCircle,
  Info,
  Globe,
  ChevronDown,
  ChevronUp,
  Layers,
  X,
  ExternalLink,
  Lock,
  Unlock,
  AlertCircle
} from 'lucide-react';

// Core Tauri v2 plugins registry
const PLUGINS = [
  {
    id: 'fs',
    name: 'File System',
    description: 'Provides access to read/write directories and file paths.',
    permissions: [
      { id: 'fs:default', label: 'fs:default', desc: 'Allows basic safe file system operations' },
      { id: 'fs:allow-read', label: 'fs:allow-read', desc: 'Allows reading files (Requires Scope)', isScoped: true },
      { id: 'fs:allow-write', label: 'fs:allow-write', desc: 'Allows writing/updating files (Requires Scope)', isScoped: true },
      { id: 'fs:allow-exists', label: 'fs:allow-exists', desc: 'Allows checking if paths exist (Requires Scope)', isScoped: true },
      { id: 'fs:allow-mkdir', label: 'fs:allow-mkdir', desc: 'Allows creating directories (Requires Scope)', isScoped: true },
      { id: 'fs:allow-remove', label: 'fs:allow-remove', desc: 'Allows deleting files/directories (Requires Scope)', isScoped: true }
    ]
  },
  {
    id: 'shell',
    name: 'Shell',
    description: 'Allows executing sidecars, spawning commands, or opening links.',
    permissions: [
      { id: 'shell:default', label: 'shell:default', desc: 'Allows basic safe shell operations' },
      { id: 'shell:allow-open', label: 'shell:allow-open', desc: 'Allows opening files or links with system default program' },
      { id: 'shell:allow-execute', label: 'shell:allow-execute', desc: 'Allows executing binaries/commands (Requires Scope)', isScoped: true },
      { id: 'shell:allow-spawn', label: 'shell:allow-spawn', desc: 'Allows spawning background processes (Requires Scope)', isScoped: true }
    ]
  },
  {
    id: 'http',
    name: 'HTTP Client',
    description: 'Allows making client network requests.',
    permissions: [
      { id: 'http:default', label: 'http:default', desc: 'Allows standard HTTP fetch operations' },
      { id: 'http:allow-request', label: 'http:allow-request', desc: 'Allows fine-grained custom HTTP requests' }
    ]
  },
  {
    id: 'dialog',
    name: 'Dialog',
    description: 'Opens native file selection, saving, or message dialogs.',
    permissions: [
      { id: 'dialog:default', label: 'dialog:default', desc: 'Allows standard dialog configurations' },
      { id: 'dialog:allow-open', label: 'dialog:allow-open', desc: 'Allows opening file selection dialogs' },
      { id: 'dialog:allow-save', label: 'dialog:allow-save', desc: 'Allows opening save file dialogs' },
      { id: 'dialog:allow-message', label: 'dialog:allow-message', desc: 'Allows showing custom alert/message dialogs' }
    ]
  },
  {
    id: 'notification',
    name: 'Notification',
    description: 'Send native desktop or mobile system notifications.',
    permissions: [
      { id: 'notification:default', label: 'notification:default', desc: 'Allows standard system notifications' },
      { id: 'notification:allow-notify', label: 'notification:allow-notify', desc: 'Allows customizing and triggering notifications' }
    ]
  },
  {
    id: 'opener',
    name: 'Opener',
    description: 'Securely open URLs, files, and directories in system browsers.',
    permissions: [
      { id: 'opener:default', label: 'opener:default', desc: 'Allows opening browser-safe URLs' },
      { id: 'opener:allow-open', label: 'opener:allow-open', desc: 'Allows opening arbitrary directories or system protocols' }
    ]
  }
];

// Presets for File System base directory paths
const BASE_DIRS = [
  '$APP_DATA', '$APP_CONFIG', '$APP_LOG', '$CACHE', '$DESKTOP', '$DOCUMENT',
  '$DOWNLOAD', '$EXE', '$HOME', '$LOCAL_DATA', '$PICTURE', '$PUBLIC',
  '$RUNTIME', '$TEMP', '$VIDEO', '$RESOURCE'
];

interface FileSystemRule {
  id: string;
  type: 'allow' | 'deny';
  path: string;
}

interface ShellRule {
  id: string;
  name: string;
  sidecar: boolean;
  args: boolean;
}

// Custom TOML Serializer
function convertToTOML(obj: any, indent = ''): string {
  if (obj === null) return 'nil';
  if (typeof obj === 'string') return `"${obj.replace(/"/g, '\\"')}"`;
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    const isPrimitiveArray = obj.every(x => typeof x !== 'object' || x === null);
    if (isPrimitiveArray) {
      return `[\n${obj.map(x => indent + '  ' + convertToTOML(x, indent + '  ')).join(',\n')}\n${indent}]`;
    } else {
      // Array of objects (inline tables in TOML array)
      return `[\n${obj.map(x => indent + '  ' + convertToInlineTOMLTable(x)).join(',\n')}\n${indent}]`;
    }
  }

  if (typeof obj === 'object') {
    let result = '';
    const keys = Object.keys(obj);
    for (const key of keys) {
      const val = obj[key];
      if (val === undefined) continue; // Skip undefined values
      const formattedKey = /^[a-zA-Z0-9_-]+$/.test(key) ? key : `"${key.replace(/"/g, '\\"')}"`;
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        result += `${indent}${formattedKey} = ${convertToInlineTOMLTable(val)}\n`;
      } else {
        result += `${indent}${formattedKey} = ${convertToTOML(val, indent)}\n`;
      }
    }
    return result;
  }

  return '';
}

function convertToInlineTOMLTable(obj: any): string {
  if (obj === null) return 'nil';
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return convertToTOML(obj);
  }
  const parts = Object.keys(obj).map(key => {
    const val = obj[key];
    if (val === undefined) return null; // Skip undefined values
    const formattedKey = /^[a-zA-Z0-9_-]+$/.test(key) ? key : `"${key.replace(/"/g, '\\"')}"`;
    if (typeof val === 'object' && val !== null) {
      if (Array.isArray(val)) {
        if (val.every(x => typeof x !== 'object' || x === null)) {
          return `${formattedKey} = [${val.map(x => convertToTOML(x)).join(', ')}]`;
        } else {
          return `${formattedKey} = [${val.map(x => convertToInlineTOMLTable(x)).join(', ')}]`;
        }
      } else {
        return `${formattedKey} = ${convertToInlineTOMLTable(val)}`;
      }
    }
    return `${formattedKey} = ${convertToTOML(val)}`;
  }).filter(x => x !== null);
  return `{ ${parts.join(', ')} }`;
}

export default function TauriCapabilityBuilder() {
  // --- STATE ---
  const [identifier, setIdentifier] = useState('default-capability');
  const [description, setDescription] = useState('Capability for the main application windows');
  
  // Windows Chip List
  const [windows, setWindows] = useState<string[]>(['main']);
  const [windowInput, setWindowInput] = useState('');
  
  // Platform Checkboxes
  const [platforms, setPlatforms] = useState<string[]>(['macOS', 'windows', 'linux', 'android', 'iOS']);
  
  // Checked/Active base permission IDs (e.g. "core:default", "fs:allow-read")
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(['core:default']);
  
  // Scope Rules lists
  const [fsRules, setFsRules] = useState<FileSystemRule[]>([]);
  const [shellRules, setShellRules] = useState<ShellRule[]>([]);
  
  // Scope builder forms
  const [scopeTab, setScopeTab] = useState<'fs' | 'shell'>('fs');
  const [selectedBaseDir, setSelectedBaseDir] = useState('$APP_DATA');
  const [globSuffix, setGlobSuffix] = useState('/**/*');
  const [fsAccessType, setFsAccessType] = useState<'allow' | 'deny'>('allow');
  
  const [shellCommand, setShellCommand] = useState('');
  const [shellSidecar, setShellSidecar] = useState(false);
  const [shellArgs, setShellArgs] = useState(true);

  // Accordion toggle states
  const [expandedAccordions, setExpandedAccordions] = useState<Record<string, boolean>>({
    fs: true,
    shell: false,
    http: false,
    dialog: false,
    notification: false,
    opener: false
  });

  // UI interaction variables
  const [format, setFormat] = useState<'json' | 'toml'>('json');
  const [copied, setCopied] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // --- HELPER HANDLERS ---
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Add Target Window Chip
  const handleAddWindow = (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    // Split by comma or whitespace to support batch adding
    const parts = windowInput.split(/[,\s]+/).map(w => w.trim()).filter(Boolean);
    
    const validParts: string[] = [];
    const invalidParts: string[] = [];
    const windowNameRegex = /^[a-zA-Z0-9_-]+$/;

    parts.forEach(part => {
      if (windowNameRegex.test(part)) {
        if (!windows.includes(part) && !validParts.includes(part)) {
          validParts.push(part);
        }
      } else {
        invalidParts.push(part);
      }
    });

    if (validParts.length > 0) {
      setWindows([...windows, ...validParts]);
      setWindowInput('');
      showToast(`Added target window(s): ${validParts.join(', ')}`);
    }

    if (invalidParts.length > 0) {
      showToast(`Invalid window name format: ${invalidParts.join(', ')} (Use alphanumeric, hyphens, underscores)`);
    }
  };

  // Remove Target Window Chip
  const handleRemoveWindow = (win: string) => {
    setWindows(windows.filter(w => w !== win));
  };

  // Toggle Operating System Target Platform
  const handleTogglePlatform = (plat: string) => {
    if (platforms.includes(plat)) {
      setPlatforms(platforms.filter(p => p !== plat));
    } else {
      setPlatforms([...platforms, plat]);
    }
  };

  // Toggle Accordion Panel Open/Closed
  const toggleAccordion = (pluginId: string) => {
    setExpandedAccordions(prev => ({ ...prev, [pluginId]: !prev[pluginId] }));
  };

  // Toggle Selection status of a plugin permission checkbox
  const handleTogglePermission = (permId: string) => {
    if (selectedPermissions.includes(permId)) {
      setSelectedPermissions(selectedPermissions.filter(p => p !== permId));
    } else {
      setSelectedPermissions([...selectedPermissions, permId]);
    }
  };

  // Scope rule: add file system access rule
  const handleAddFsRule = (e: React.FormEvent) => {
    e.preventDefault();
    
    let cleanSuffix = globSuffix.trim();
    if (cleanSuffix) {
      // Prepend slash if not starting with slash or asterisk/wildcard
      if (!cleanSuffix.startsWith('/') && !cleanSuffix.startsWith('\\')) {
        cleanSuffix = '/' + cleanSuffix;
      }
      // Replace multiple slashes with a single slash
      cleanSuffix = cleanSuffix.replace(/[\/\\]+/g, '/');
    }
    const finalPath = `${selectedBaseDir}${cleanSuffix}`;

    // Duplicate check
    const isDuplicate = fsRules.some(
      r => r.type === fsAccessType && r.path === finalPath
    );
    if (isDuplicate) {
      showToast(`Filesystem rule for "${finalPath}" already exists!`);
      return;
    }

    const newRule: FileSystemRule = {
      id: `fs-rule-${Date.now()}`,
      type: fsAccessType,
      path: finalPath
    };
    setFsRules([...fsRules, newRule]);
    showToast(`Added file system rule: ${finalPath}`);
  };

  // Scope rule: add shell command execution rule
  const handleAddShellRule = (e: React.FormEvent) => {
    e.preventDefault();
    const commandName = shellCommand.trim();
    if (!commandName) return;

    // Duplicate check
    const isDuplicate = shellRules.some(
      r => r.name.toLowerCase() === commandName.toLowerCase() &&
           r.sidecar === shellSidecar &&
           r.args === shellArgs
    );
    if (isDuplicate) {
      showToast(`Shell rule for "${commandName}" already exists!`);
      return;
    }

    const newRule: ShellRule = {
      id: `shell-rule-${Date.now()}`,
      name: commandName,
      sidecar: shellSidecar,
      args: shellArgs
    };
    setShellRules([...shellRules, newRule]);
    setShellCommand('');
    showToast(`Added shell execute rule: ${commandName}`);
  };

  // Delete File System Rule
  const handleDeleteFsRule = (id: string) => {
    setFsRules(fsRules.filter(r => r.id !== id));
  };

  // Delete Shell Rule
  const handleDeleteShellRule = (id: string) => {
    setShellRules(shellRules.filter(r => r.id !== id));
  };

  // --- TAURI SCHEMA SERIALIZATION ENGINE ---
  const capabilityObject = useMemo(() => {
    // Separate filesystem permissions that require scopes vs other permission types
    const fsPermissions = selectedPermissions.filter(p => p.startsWith('fs:') && p !== 'fs:default');
    const shellPermissions = selectedPermissions.filter(p => (p === 'shell:allow-execute' || p === 'shell:allow-spawn'));
    const otherPermissions = selectedPermissions.filter(p => {
      const isFsScoped = p.startsWith('fs:') && p !== 'fs:default';
      const isShellScoped = p === 'shell:allow-execute' || p === 'shell:allow-spawn';
      return !isFsScoped && !isShellScoped;
    });

    const parsedPermissions: any[] = [...otherPermissions];

    // Map scoped File System rules
    if (fsPermissions.length > 0) {
      const scopeObject: { allow?: { path: string }[]; deny?: { path: string }[] } = {};
      
      const allows = fsRules.filter(r => r.type === 'allow').map(r => ({ path: r.path }));
      const denies = fsRules.filter(r => r.type === 'deny').map(r => ({ path: r.path }));
      
      if (allows.length > 0) scopeObject.allow = allows;
      if (denies.length > 0) scopeObject.deny = denies;

      // Add each filesystem permission with the configured scope object
      fsPermissions.forEach(perm => {
        parsedPermissions.push({
          identifier: perm,
          scope: scopeObject
        });
      });
    }

    // Map scoped Shell command execution rules
    if (shellPermissions.length > 0) {
      const allows = shellRules.map(r => ({
        name: r.name,
        sidecar: r.sidecar,
        args: r.args
      }));

      shellPermissions.forEach(perm => {
        parsedPermissions.push({
          identifier: perm,
          allow: allows
        });
      });
    }

    return {
      $schema: '../gen/schemas/desktop-schema.json',
      identifier,
      description: description || undefined,
      windows: windows.length > 0 ? windows : undefined,
      platforms: platforms.length > 0 ? platforms : undefined,
      permissions: parsedPermissions
    };
  }, [identifier, description, windows, platforms, selectedPermissions, fsRules, shellRules]);

  // Output strings
  const jsonOutput = useMemo(() => JSON.stringify(capabilityObject, null, 2), [capabilityObject]);
  const tomlOutput = useMemo(() => convertToTOML(capabilityObject), [capabilityObject]);
  const activeCodeOutput = format === 'json' ? jsonOutput : tomlOutput;

  // --- LIVE VALIDATOR CHECKS ---
  const validationAlerts = useMemo(() => {
    const alerts: { type: 'error' | 'warning'; msg: string }[] = [];

    // Identifier validation
    if (!identifier) {
      alerts.push({ type: 'error', msg: 'Capability identifier is required.' });
    } else {
      const kebabRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
      if (!kebabRegex.test(identifier)) {
        alerts.push({ type: 'error', msg: 'Identifier must be in lowercase-kebab-case (e.g., "my-awesome-plugin").' });
      }
    }

    // Empty Permissions check
    if (selectedPermissions.length === 0) {
      alerts.push({ type: 'warning', msg: 'No permissions selected. This capability configuration will grant no system permissions.' });
    }

    // FS Permission Scopes validation
    const hasFsScoped = selectedPermissions.some(p => p.startsWith('fs:') && p !== 'fs:default');
    if (hasFsScoped && fsRules.length === 0) {
      alerts.push({ type: 'warning', msg: 'Filesystem permissions are enabled (e.g., fs:allow-read) but no FS Scope path rules have been added.' });
    }

    // Shell Permission Scopes validation
    const hasShellScoped = selectedPermissions.some(p => p === 'shell:allow-execute' || p === 'shell:allow-spawn');
    if (hasShellScoped && shellRules.length === 0) {
      alerts.push({ type: 'warning', msg: 'Shell command execution is enabled (e.g., shell:allow-execute) but no Shell commands are specified in the Scope.' });
    }

    // Security warning for overly permissive root directories
    const hasOverPermissiveFs = fsRules.some(r => {
      const lower = r.path.toLowerCase();
      return (lower.includes('$home/**/*') || lower.includes('$home/*') || lower.startsWith('$home') && lower.endsWith('/**/*'));
    });
    if (hasOverPermissiveFs) {
      alerts.push({ type: 'warning', msg: 'Security Warning: Allowing recursive read/write access to $HOME can leak sensitive host system data.' });
    }
    // Inactive FS Scope rules check
    if (fsRules.length > 0 && !hasFsScoped) {
      alerts.push({ type: 'warning', msg: 'Inactive Rules: You have defined file system scope rules, but no scoped file system permissions (like "fs:allow-read") are checked. These scope rules will not be active.' });
    }

    // Inactive Shell Scope rules check
    if (shellRules.length > 0 && !hasShellScoped) {
      alerts.push({ type: 'warning', msg: 'Inactive Rules: You have defined shell command rules, but no scoped shell execution permissions (like "shell:allow-execute" or "shell:allow-spawn") are checked. These command rules will not be active.' });
    }

    // Check if default is used with sub-permissions (redundant config)
    if (selectedPermissions.includes('fs:default') && hasFsScoped) {
      alerts.push({ type: 'warning', msg: 'Redundancy: "fs:default" is enabled alongside scoped sub-permissions (e.g., "fs:allow-read"). Consider selecting only what you need.' });
    }
    if (selectedPermissions.includes('shell:default') && hasShellScoped) {
      alerts.push({ type: 'warning', msg: 'Redundancy: "shell:default" is active alongside command execution scopes. "shell:default" usually suffices for standard UI tasks.' });
    }

    return alerts;
  }, [identifier, selectedPermissions, fsRules, shellRules]);

  // --- REVERSE CAPABILITY PARSER (IMPORT SYSTEM) ---
  const handleImportCapability = () => {
    try {
      setImportError(null);
      const parsed = JSON.parse(importCode);

      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Invalid JSON format. Root must be a JSON object.');
      }

      // Hydrate Identifier (fallback to default)
      setIdentifier(parsed.identifier && typeof parsed.identifier === 'string' ? parsed.identifier : 'default-capability');
      
      // Hydrate Description (fallback to empty)
      setDescription(parsed.description && typeof parsed.description === 'string' ? parsed.description : '');

      // Hydrate target windows (fallback to empty array)
      if (parsed.windows && Array.isArray(parsed.windows)) {
        setWindows(parsed.windows.map(w => String(w)));
      } else {
        setWindows([]);
      }

      // Hydrate target platforms (fallback to empty array)
      if (parsed.platforms && Array.isArray(parsed.platforms)) {
        setPlatforms(parsed.platforms.map(p => String(p)));
      } else {
        setPlatforms([]);
      }

      // Hydrate permissions and nested scopes (fallback to empty rules)
      const importPerms: string[] = [];
      const importFsRules: FileSystemRule[] = [];
      const importShellRules: ShellRule[] = [];

      if (parsed.permissions && Array.isArray(parsed.permissions)) {
        parsed.permissions.forEach((perm: any) => {
          if (typeof perm === 'string') {
            importPerms.push(perm);
          } else if (typeof perm === 'object' && perm !== null && perm.identifier) {
            const id = String(perm.identifier);
            importPerms.push(id);

            // Parse Filesystem scope
            if (id.startsWith('fs:') && perm.scope) {
              const scope = perm.scope;
              if (scope.allow && Array.isArray(scope.allow)) {
                scope.allow.forEach((allowItem: any, idx: number) => {
                  if (allowItem && allowItem.path) {
                    importFsRules.push({
                      id: `imported-fs-allow-${Date.now()}-${idx}-${Math.random()}`,
                      type: 'allow',
                      path: String(allowItem.path)
                    });
                  }
                });
              }
              if (scope.deny && Array.isArray(scope.deny)) {
                scope.deny.forEach((denyItem: any, idx: number) => {
                  if (denyItem && denyItem.path) {
                    importFsRules.push({
                      id: `imported-fs-deny-${Date.now()}-${idx}-${Math.random()}`,
                      type: 'deny',
                      path: String(denyItem.path)
                    });
                  }
                });
              }
            }

            // Parse Shell scope
            if ((id === 'shell:allow-execute' || id === 'shell:allow-spawn') && perm.allow && Array.isArray(perm.allow)) {
              perm.allow.forEach((allowItem: any, idx: number) => {
                if (allowItem && allowItem.name) {
                  importShellRules.push({
                    id: `imported-shell-${Date.now()}-${idx}-${Math.random()}`,
                    name: String(allowItem.name),
                    sidecar: !!allowItem.sidecar,
                    args: allowItem.args !== undefined ? !!allowItem.args : true
                  });
                }
              });
            }
          }
        });
      }

      // Unique permissions check
      setSelectedPermissions(Array.from(new Set(importPerms)));
      
      // De-duplicate imported filesystem and shell rules
      const uniqueFsRules = importFsRules.filter((v, i, a) => a.findIndex(t => t.path === v.path && t.type === v.type) === i);
      const uniqueShellRules = importShellRules.filter((v, i, a) => a.findIndex(t => t.name === v.name && t.sidecar === v.sidecar && t.args === v.args) === i);
      
      setFsRules(uniqueFsRules);
      setShellRules(uniqueShellRules);

      setImportModalOpen(false);
      setImportCode('');
      showToast('Capability successfully imported and visual form populated!');
    } catch (err: any) {
      setImportError(err.message || 'JSON parsing failed. Please verify syntax.');
    }
  };

  // --- ACTIONS: COPY & DOWNLOAD ---
  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(activeCodeOutput).then(() => {
      setCopied(true);
      showToast('Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadFile = () => {
    const filename = format === 'json' ? `${identifier}.json` : `${identifier}.toml`;
    const blob = new Blob([activeCodeOutput], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Downloaded config file: ${filename}`);
  };

  // --- CUSTOM SHIKI-STYLE SYNTAX HIGHLIGHTING RENDERER ---
  const renderHighlightedCode = () => {
    const code = activeCodeOutput;
    
    if (format === 'json') {
      const tokenRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"\s*:)|("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")|(-?\d+(\.\d+)?([eE][+-]?\d+)?)|(true|false|null)|([{}[\]:,])|(\s+)/g;
      const tokens: React.ReactNode[] = [];
      let match;
      let i = 0;
      let lastMatchIndex = 0;

      tokenRegex.lastIndex = 0;
      while ((match = tokenRegex.exec(code)) !== null) {
        const matchIndex = match.index;
        if (matchIndex > lastMatchIndex) {
          tokens.push(code.substring(lastMatchIndex, matchIndex));
        }
        lastMatchIndex = tokenRegex.lastIndex;

        const text = match[0];
        if (match[1]) {
          const keyText = text.substring(0, text.length - 1);
          tokens.push(<span key={`key-${i++}`} className="text-indigo-400 font-medium">{keyText}</span>);
          tokens.push(<span key={`col-${i++}`} className="text-zinc-500">:</span>);
        } else if (match[3]) {
          tokens.push(<span key={`str-${i++}`} className="text-emerald-400">{text}</span>);
        } else if (match[5]) {
          tokens.push(<span key={`num-${i++}`} className="text-amber-400">{text}</span>);
        } else if (match[8]) {
          tokens.push(<span key={`bool-${i++}`} className="text-purple-400 font-semibold">{text}</span>);
        } else if (match[9]) {
          tokens.push(<span key={`punc-${i++}`} className="text-zinc-400">{text}</span>);
        } else {
          tokens.push(text);
        }
      }
      if (lastMatchIndex < code.length) {
        tokens.push(code.substring(lastMatchIndex));
      }
      return tokens;
    } else {
      const tokenRegex = /(#.*)|(\[[a-zA-Z0-9_.-]+\])|("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"\s*=)|([a-zA-Z0-9_.-]+\s*=)|("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")|(-?\d+(\.\d+)?([eE][+-]?\d+)?)|(true|false|null)|([{}[\]=,])|(\s+)/g;
      const tokens: React.ReactNode[] = [];
      let match;
      let i = 0;
      let lastMatchIndex = 0;

      tokenRegex.lastIndex = 0;
      while ((match = tokenRegex.exec(code)) !== null) {
        const matchIndex = match.index;
        if (matchIndex > lastMatchIndex) {
          tokens.push(code.substring(lastMatchIndex, matchIndex));
        }
        lastMatchIndex = tokenRegex.lastIndex;

        const text = match[0];
        if (match[1]) {
          tokens.push(<span key={`comm-${i++}`} className="text-zinc-500 italic">{text}</span>);
        } else if (match[2]) {
          tokens.push(<span key={`sect-${i++}`} className="text-pink-400 font-medium">{text}</span>);
        } else if (match[3]) {
          const eqIdx = text.lastIndexOf('=');
          const keyPart = text.substring(0, eqIdx);
          tokens.push(<span key={`keyq-${i++}`} className="text-indigo-400 font-medium">{keyPart}</span>);
          tokens.push(<span key={`eqq-${i++}`} className="text-zinc-400">=</span>);
        } else if (match[5]) {
          const eqIdx = text.lastIndexOf('=');
          const keyPart = text.substring(0, eqIdx);
          tokens.push(<span key={`keyu-${i++}`} className="text-indigo-400 font-medium">{keyPart}</span>);
          tokens.push(<span key={`equ-${i++}`} className="text-zinc-400">=</span>);
        } else if (match[6]) {
          tokens.push(<span key={`str-${i++}`} className="text-emerald-400">{text}</span>);
        } else if (match[8]) {
          tokens.push(<span key={`num-${i++}`} className="text-amber-400">{text}</span>);
        } else if (match[10]) {
          tokens.push(<span key={`bool-${i++}`} className="text-purple-400 font-semibold">{text}</span>);
        } else if (match[11]) {
          tokens.push(<span key={`punc-${i++}`} className="text-zinc-400">{text}</span>);
        } else {
          tokens.push(text);
        }
      }
      if (lastMatchIndex < code.length) {
        tokens.push(code.substring(lastMatchIndex));
      }
      return tokens;
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 text-zinc-100 flex flex-col min-h-screen">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 border border-zinc-700/80 shadow-2xl text-emerald-400 px-4 py-3 rounded-lg flex items-center gap-3 backdrop-blur-md animate-bounce">
          <Check size={18} />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* --- TOP BRAND HEADER --- */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-zinc-800 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent">
              Tauri v2 Capability Builder
            </h1>
          </div>
          <p className="text-zinc-400 text-sm mt-1">
            Build, validate, and preview security permissions capabilities for Tauri v2 configurations.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="flex items-center gap-1.5 bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded-full text-xs font-medium border border-indigo-500/20">
              <Globe size={12} />
              Tauri v2 Security Utility
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setImportModalOpen(true)}
            className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 px-4 py-2 rounded-lg font-medium text-sm transition cursor-pointer"
          >
            <Upload size={16} />
            Import JSON
          </button>
          <a
            href="https://v2.tauri.app/security/capabilities/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-350 px-4 py-2 rounded-lg font-medium text-sm transition"
          >
            <Info size={16} />
            Docs
            <ExternalLink size={14} className="opacity-60" />
          </a>
        </div>
      </header>

      {/* --- TWO PANE LAYOUT --- */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 items-start">
        
        {/* --- LEFT PANE: CONFIGURATION FORMS --- */}
        <section className="lg:col-span-7 flex flex-col gap-6 max-h-[85vh] overflow-y-auto pr-2">
          
          {/* Card 1: Metadata Settings */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 backdrop-blur rounded-xl p-6 flex flex-col gap-5">
            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-lg border-b border-zinc-805 pb-3">
              <Layers size={18} />
              <h2>1. Capability Metadata</h2>
            </div>

            {/* Identifier */}
            <div className="flex flex-col gap-2">
              <label htmlFor="identifier-input" className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex justify-between">
                Identifier
                <span className="text-indigo-400 lowercase font-normal italic">kebab-case pattern</span>
              </label>
              <input
                id="identifier-input"
                type="text"
                placeholder="default-capability"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value.toLowerCase())}
                className="bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-2.5 text-zinc-100 placeholder-zinc-700 text-sm focus:outline-none transition"
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-2">
              <label htmlFor="description-input" className="text-xs font-bold uppercase tracking-wider text-zinc-400">Description</label>
              <textarea
                id="description-input"
                rows={2}
                placeholder="Briefly describe the security limits of this capability file..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-2.5 text-zinc-100 placeholder-zinc-700 text-sm focus:outline-none transition resize-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Target Windows Chips */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Target Windows</label>
                <form onSubmit={handleAddWindow} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. main, logs"
                    value={windowInput}
                    onChange={(e) => setWindowInput(e.target.value)}
                    className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-700 text-sm focus:outline-none transition"
                  />
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3 py-2 transition cursor-pointer"
                  >
                    <Plus size={16} />
                  </button>
                </form>
                {/* Chip Container */}
                <div className="flex flex-wrap gap-2 mt-1">
                  {windows.map(win => (
                    <span key={win} className="flex items-center gap-1.5 bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-full text-xs font-mono font-medium text-zinc-200">
                      {win}
                      <button type="button" onClick={() => handleRemoveWindow(win)} className="hover:text-red-400 transition cursor-pointer">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  {windows.length === 0 && (
                    <span className="text-zinc-650 text-xs italic">All windows targeted by default if omitted</span>
                  )}
                </div>
              </div>

              {/* Target Platforms */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Target Platforms</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {['macOS', 'windows', 'linux', 'android', 'iOS'].map(plat => {
                    const active = platforms.includes(plat);
                    return (
                      <button
                        key={plat}
                        type="button"
                        onClick={() => handleTogglePlatform(plat)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold tracking-wide transition cursor-pointer ${
                          active
                            ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400 font-bold'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-350'
                        }`}
                      >
                        {plat}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Permissions Matrices */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 backdrop-blur rounded-xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-lg border-b border-zinc-805 pb-3">
              <Lock size={18} />
              <h2>2. Core Plugins Permissions Matrix</h2>
            </div>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Toggle specific security permissions for each core Tauri plug-in. Adding a scoped permission (like <code className="text-indigo-400 text-[11px]">fs:allow-read</code>) will prompt you to configure custom scope parameters.
            </p>

            <div className="flex flex-col gap-3.5 mt-2">
              {PLUGINS.map(plugin => {
                const isExpanded = expandedAccordions[plugin.id];
                const activePermsCount = plugin.permissions.filter(p => selectedPermissions.includes(p.id)).length;
                
                return (
                  <div key={plugin.id} className="border border-zinc-800/60 rounded-xl bg-zinc-950/60 overflow-hidden transition">
                    
                    {/* Accordion header */}
                    <button
                      type="button"
                      onClick={() => toggleAccordion(plugin.id)}
                      className="w-full flex items-center justify-between px-5 py-4 bg-zinc-900/40 hover:bg-zinc-900/70 transition text-left cursor-pointer"
                    >
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm text-zinc-200 flex items-center gap-2.5">
                          {plugin.name}
                          {activePermsCount > 0 && (
                            <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-[10px] px-1.5 py-0.5 rounded font-bold">
                              {activePermsCount} Active
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-zinc-550 mt-0.5 font-normal">{plugin.description}</span>
                      </div>
                      {isExpanded ? <ChevronUp size={16} className="text-zinc-500" /> : <ChevronDown size={16} className="text-zinc-500" />}
                    </button>

                    {/* Accordion content */}
                    {isExpanded && (
                      <div className="p-5 border-t border-zinc-850 bg-zinc-950/20 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {plugin.permissions.map(perm => {
                          const isChecked = selectedPermissions.includes(perm.id);
                          return (
                            <label
                              key={perm.id}
                              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-zinc-900/30 transition ${
                                isChecked
                                  ? 'border-indigo-500/30 bg-indigo-500/5'
                                  : 'border-zinc-850 bg-zinc-950/50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleTogglePermission(perm.id)}
                                className="mt-0.5 rounded border-zinc-800 text-indigo-600 focus:ring-indigo-500 bg-zinc-900 cursor-pointer"
                              />
                              <div className="flex flex-col gap-0.5">
                                <span className="text-xs font-mono font-semibold text-zinc-200 flex items-center gap-1.5">
                                  {perm.label}
                                  {perm.isScoped && (
                                    <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.2 rounded font-sans font-bold">
                                      Needs Scope
                                    </span>
                                  )}
                                </span>
                                <span className="text-[11px] text-zinc-500 leading-tight">{perm.desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Card 3: Dynamic Scope Builder */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 backdrop-blur rounded-xl p-6 flex flex-col gap-5 glow-indigo">
            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-lg border-b border-zinc-805 pb-3">
              <Unlock size={18} />
              <h2>3. Dynamic Scope Rules Engine</h2>
            </div>

            {/* Scope tabs switcher */}
            <div className="flex border-b border-zinc-800/60">
              <button
                type="button"
                onClick={() => setScopeTab('fs')}
                className={`px-4 py-2 border-b-2 text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                  scopeTab === 'fs'
                    ? 'border-indigo-500 text-indigo-400 font-extrabold'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Filesystem Scopes (fs)
              </button>
              <button
                type="button"
                onClick={() => setScopeTab('shell')}
                className={`px-4 py-2 border-b-2 text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                  scopeTab === 'shell'
                    ? 'border-indigo-500 text-indigo-400 font-extrabold'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Shell Scopes (shell)
              </button>
            </div>

            {/* FS Rule Builder Form */}
            {scopeTab === 'fs' && (
              <form onSubmit={handleAddFsRule} className="flex flex-col gap-4 bg-zinc-950/40 p-4 rounded-xl border border-zinc-850">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Base Directory Selector */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold uppercase text-zinc-500">Base Path Variable</label>
                    <select
                      value={selectedBaseDir}
                      onChange={(e) => setSelectedBaseDir(e.target.value)}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {BASE_DIRS.map(dir => (
                        <option key={dir} value={dir}>{dir}</option>
                      ))}
                    </select>
                  </div>

                  {/* Glob Suffix Input */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold uppercase text-zinc-500 font-mono">Glob Suffix (Regex)</label>
                    <input
                      type="text"
                      placeholder="e.g. /**/*, /config.json"
                      value={globSuffix}
                      onChange={(e) => setGlobSuffix(e.target.value)}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  {/* Rule access type Allow / Deny */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold uppercase text-zinc-500">Access Rule Type</label>
                    <div className="flex bg-zinc-950 rounded-lg p-1 border border-zinc-800">
                      <button
                        type="button"
                        onClick={() => setFsAccessType('allow')}
                        className={`flex-1 text-center py-1 rounded text-xs font-semibold transition cursor-pointer ${
                          fsAccessType === 'allow' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-305'
                        }`}
                      >
                        Allow
                      </button>
                      <button
                        type="button"
                        onClick={() => setFsAccessType('deny')}
                        className={`flex-1 text-center py-1 rounded text-xs font-semibold transition cursor-pointer ${
                          fsAccessType === 'deny' ? 'bg-red-650/80 text-white' : 'text-zinc-500 hover:text-zinc-350'
                        }`}
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/10 text-white rounded-lg py-2 text-xs font-bold uppercase tracking-wider mt-2 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus size={14} />
                  Add File system Rule
                </button>
              </form>
            )}

            {/* Shell Rule Builder Form */}
            {scopeTab === 'shell' && (
              <form onSubmit={handleAddShellRule} className="flex flex-col gap-4 bg-zinc-950/40 p-4 rounded-xl border border-zinc-850">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Command Name */}
                  <div className="flex flex-col gap-2 col-span-2">
                    <label className="text-[10px] font-bold uppercase text-zinc-500">Command Name / Path</label>
                    <input
                      type="text"
                      placeholder="e.g. binaries/my-sidecar, cmd.exe, git"
                      value={shellCommand}
                      onChange={(e) => setShellCommand(e.target.value)}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>

                <div className="flex gap-6 mt-1">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={shellSidecar}
                      onChange={(e) => setShellSidecar(e.target.checked)}
                      className="rounded border-zinc-800 text-indigo-600 focus:ring-indigo-500 bg-zinc-900 cursor-pointer"
                    />
                    Is Sidecar Command
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={shellArgs}
                      onChange={(e) => setShellArgs(e.target.checked)}
                      className="rounded border-zinc-800 text-indigo-600 focus:ring-indigo-500 bg-zinc-900 cursor-pointer"
                    />
                    Accepts Arguments
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={!shellCommand.trim()}
                  className="disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/10 text-white rounded-lg py-2 text-xs font-bold uppercase tracking-wider mt-2 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus size={14} />
                  Add Shell Command Rule
                </button>
              </form>
            )}

            {/* Scope rules listing tables */}
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mt-2">Active Rules Table</h3>
              
              {/* Filesystem rules table */}
              {scopeTab === 'fs' && (
                <div className="border border-zinc-850 rounded-lg overflow-hidden bg-zinc-950/20">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-zinc-900/60 border-b border-zinc-850 text-zinc-450">
                        <th className="px-4 py-2.5 font-semibold">Type</th>
                        <th className="px-4 py-2.5 font-semibold">Scope Path Target</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fsRules.map(rule => (
                        <tr key={rule.id} className="border-b border-zinc-850/60 hover:bg-zinc-900/20 text-zinc-300 font-mono transition">
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              rule.type === 'allow' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}>
                              {rule.type.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2 font-medium">{rule.path}</td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteFsRule(rule.id)}
                              className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded transition cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {fsRules.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-6 text-center text-zinc-650 italic font-sans">
                            No filesystem scope rules added. Scoped permissions will generate warnings.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Shell rules table */}
              {scopeTab === 'shell' && (
                <div className="border border-zinc-850 rounded-lg overflow-hidden bg-zinc-950/20">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-zinc-900/60 border-b border-zinc-850 text-zinc-450">
                        <th className="px-4 py-2.5 font-semibold">Command Name</th>
                        <th className="px-4 py-2.5 font-semibold">Sidecar</th>
                        <th className="px-4 py-2.5 font-semibold">Args</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shellRules.map(rule => (
                        <tr key={rule.id} className="border-b border-zinc-850/60 hover:bg-zinc-900/20 text-zinc-300 font-mono transition">
                          <td className="px-4 py-2 font-medium">{rule.name}</td>
                          <td className="px-4 py-2">{rule.sidecar ? 'true' : 'false'}</td>
                          <td className="px-4 py-2">{rule.args ? 'true' : 'false'}</td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteShellRule(rule.id)}
                              className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded transition cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {shellRules.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-zinc-650 italic font-sans">
                            No shell execution scope rules defined. Scoped shell permissions will generate warnings.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* --- RIGHT PANE: REAL-TIME OUTPUT & CODE PLAYGROUND --- */}
        <section className="lg:col-span-5 flex flex-col gap-6 lg:sticky lg:top-8 max-h-[85vh]">
          
          {/* Card 4: Code Output & Playground */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 backdrop-blur rounded-xl p-5 flex flex-col gap-4 flex-1">
            <div className="flex flex-row justify-between items-center border-b border-zinc-805 pb-3 gap-2">
              {/* Format Tab Swapper */}
              <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-850">
                <button
                  type="button"
                  onClick={() => setFormat('json')}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition uppercase tracking-wider cursor-pointer ${
                    format === 'json' ? 'bg-zinc-800 text-indigo-400 font-extrabold shadow' : 'text-zinc-500 hover:text-zinc-305'
                  }`}
                >
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => setFormat('toml')}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition uppercase tracking-wider cursor-pointer ${
                    format === 'toml' ? 'bg-zinc-800 text-indigo-400 font-extrabold shadow' : 'text-zinc-500 hover:text-zinc-305'
                  }`}
                >
                  TOML
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopyToClipboard}
                  className="flex items-center gap-1.5 bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
                  title="Copy to Clipboard"
                >
                  {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadFile}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 hover:shadow hover:shadow-indigo-500/10 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
                  title="Download File"
                >
                  <Download size={13} />
                  Download
                </button>
              </div>
            </div>

            {/* Code Viewport (Shiki Highlighted) */}
            <div className="relative flex-1 bg-zinc-950 border border-zinc-850 rounded-xl overflow-hidden min-h-[300px] flex flex-col font-mono text-xs text-zinc-300">
              {/* Editor Header Bar */}
              <div className="bg-zinc-900/30 px-4 py-2 border-b border-zinc-850/60 flex items-center justify-between text-zinc-500 text-[10px] tracking-wide select-none">
                <span className="font-semibold">{format === 'json' ? 'src-tauri/capabilities/default.json' : 'src-tauri/capabilities/default.toml'}</span>
                <span>READ-ONLY</span>
              </div>
              {/* Code text scrollable box */}
              <div className="p-5 overflow-auto flex-1 font-mono leading-relaxed select-text whitespace-pre">
                <code>{renderHighlightedCode()}</code>
              </div>
            </div>
          </div>

          {/* Card 5: Real-Time Security & Syntax Validator */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 backdrop-blur rounded-xl p-5">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold text-sm border-b border-zinc-850 pb-2.5 mb-3">
              <ShieldAlert size={16} className="text-indigo-400" />
              <h3>Visual Validation & Safety Checklist</h3>
            </div>

            <div className="flex flex-col gap-2">
              {validationAlerts.map((alert, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed ${
                    alert.type === 'error'
                      ? 'bg-red-500/10 border-red-500/20 text-red-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  }`}
                >
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{alert.msg}</span>
                </div>
              ))}

              {validationAlerts.length === 0 && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs">
                  <Check size={14} className="shrink-0" />
                  <span className="font-medium">Everything looks secure! Zero warnings or syntax anomalies detected.</span>
                </div>
              )}
            </div>
          </div>
        </section>

      </main>

      {/* --- IMPORT MODAL --- */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="px-6 py-4 bg-zinc-950 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2.5">
                <Upload size={18} className="text-indigo-400" />
                Import Existing Tauri Capability File
              </h2>
              <button
                type="button"
                onClick={() => { setImportModalOpen(false); setImportError(null); }}
                className="text-zinc-500 hover:text-zinc-350 transition cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col gap-4 overflow-y-auto">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Paste the contents of your Tauri v2 capability configuration file (e.g. <code className="text-indigo-400">default.json</code>) in the text box below. The importer will parse the identifier, active permission sets, and recursive scopes automatically to hydrate the UI.
              </p>

              {importError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-start gap-2.5">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              <div className="flex-1 min-h-[250px] flex flex-col">
                <textarea
                  rows={12}
                  placeholder='{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default-capability",
  "permissions": [
    "core:default",
    {
      "identifier": "fs:allow-read",
      "scope": {
        "allow": [{ "path": "$APP_DATA/**/*" }]
      }
    }
  ]
}'
                  value={importCode}
                  onChange={(e) => setImportCode(e.target.value)}
                  className="w-full flex-1 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl p-4 text-zinc-200 placeholder-zinc-700 text-xs font-mono focus:outline-none transition resize-none"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-850/60 flex justify-end gap-3 select-none">
              <button
                type="button"
                onClick={() => { setImportModalOpen(false); setImportError(null); }}
                className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 px-4 py-2 rounded-lg font-semibold text-sm transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportCapability}
                disabled={!importCode.trim()}
                className="disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-lg font-semibold text-sm transition cursor-pointer"
              >
                Parse & Populate Form
              </button>
            </div>

          </div>
        </div>
      )}

      {/* --- FOOTER SITE BRANDING --- */}
      <footer className="mt-16 pt-6 border-t border-zinc-850/60 flex flex-col md:flex-row justify-between items-center text-xs text-zinc-550 gap-4">
        <p>© 2026 Tauri Capability Builder. Build secure desktop applications.</p>
      </footer>

    </div>
  );
}
