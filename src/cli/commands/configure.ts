import inquirer from 'inquirer';
import { generateNewKeyPair, resolveToHex, getPublicKeyFromSecret, nip19 } from '../../channels/nostr/index.js';
import { Workspace } from '../../core/workspace.js';
import { loadConfig, CONFIG_FILE, KEYS_FILE, VOLTCLAW_DIR, type CLIConfig } from '../config.js';
import fs from 'fs/promises';

export async function configureCommand(): Promise<void> {
  console.log('Welcome to VoltClaw Configuration Wizard\n');

  // Ensure VoltClaw dir exists
  await fs.mkdir(VOLTCLAW_DIR, { recursive: true });

  const currentConfig = await loadConfig();

  // 1. LLM Configuration
  const llmAnswers = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select LLM Provider:',
      choices: ['ollama', 'openai', 'anthropic'],
      default: currentConfig.llm.provider
    },
    {
      type: 'input',
      name: 'model',
      message: 'Enter Model Name:',
      default: (answers: Record<string, unknown>): string => {
        if (answers.provider === 'ollama') return 'llama3.2';
        if (answers.provider === 'openai') return 'gpt-4o';
        if (answers.provider === 'anthropic') return 'claude-3-5-sonnet-20241022';
        return 'gpt-4o';
      }
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Enter Base URL (optional):',
      default: 'http://localhost:11434',
      when: (answers: Record<string, unknown>): boolean => answers.provider === 'ollama'
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter API Key:',
      when: (answers: Record<string, unknown>): boolean => answers.provider !== 'ollama',
      mask: '*'
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);

  // 2. Channel Configuration
  const channels = [...(currentConfig.channels ?? [])];

  // Configure Nostr
  const nostrEnabled = await inquirer.prompt([
      {
          type: 'confirm',
          name: 'enable',
          message: 'Enable Nostr integration?',
          default: channels.some(c => c.type === 'nostr')
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);

  if (nostrEnabled.enable === true) {
      const existingRelays = channels.find(c => c.type === 'nostr')?.relays ?? [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band'
      ];

      const nostrAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'relays',
          message: 'Enter Nostr Relays (comma separated):',
          default: existingRelays.join(', ')
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);

      const relays = nostrAnswers.relays.split(',').map((r: string) => r.trim()).filter((r: string) => r !== '');

      const idx = channels.findIndex(c => c.type === 'nostr');
      if (idx >= 0) {
          channels[idx] = { ...channels[idx], type: 'nostr', relays };
      } else {
          channels.push({ type: 'nostr', relays });
      }
  } else {
      const idx = channels.findIndex(c => c.type === 'nostr');
      if (idx >= 0) channels.splice(idx, 1);
  }

  // Configure Telegram
  const telegramAnswers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enable',
      message: 'Enable Telegram integration?',
      default: channels.some(c => c.type === 'telegram') || process.env.TELEGRAM_TOKEN !== undefined
    },
    {
      type: 'password',
      name: 'token',
      message: 'Enter Telegram Bot Token:',
      when: (answers: Record<string, unknown>): boolean => answers.enable === true && process.env.TELEGRAM_TOKEN === undefined,
      default: channels.find(c => c.type === 'telegram')?.token,
      mask: '*'
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);

  if (telegramAnswers.enable === true) {
      const existing = channels.findIndex(c => c.type === 'telegram');
      const token = telegramAnswers.token ?? channels.find(c => c.type === 'telegram')?.token ?? process.env.TELEGRAM_TOKEN;
      if (token === undefined || token === '') {
        console.error('Telegram token is required.');
        return;
      }
      const config = { type: 'telegram' as const, token: String(token) };
      if (existing >= 0) {
          channels[existing] = config;
      } else {
          channels.push(config);
      }
  } else {
      const existing = channels.findIndex(c => c.type === 'telegram');
      if (existing >= 0) channels.splice(existing, 1);
  }

  // Configure Discord
  const discordAnswers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enable',
      message: 'Enable Discord integration?',
      default: channels.some(c => c.type === 'discord') || process.env.DISCORD_TOKEN !== undefined
    },
    {
      type: 'password',
      name: 'token',
      message: 'Enter Discord Bot Token:',
      when: (answers: Record<string, unknown>): boolean => answers.enable === true && process.env.DISCORD_TOKEN === undefined,
      default: channels.find(c => c.type === 'discord')?.token,
      mask: '*'
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);

  if (discordAnswers.enable === true) {
      const existing = channels.findIndex(c => c.type === 'discord');
      const token = discordAnswers.token ?? channels.find(c => c.type === 'discord')?.token ?? process.env.DISCORD_TOKEN;
      if (token === undefined || token === '') {
        console.error('Discord token is required.');
        return;
      }
      const config = { type: 'discord' as const, token: String(token) };
      if (existing >= 0) {
          channels[existing] = config;
      } else {
          channels.push(config);
      }
  } else {
      const existing = channels.findIndex(c => c.type === 'discord');
      if (existing >= 0) channels.splice(existing, 1);
  }

  // 3. Identity Configuration (Nostr Only)
  let keys = { publicKey: '', secretKey: '', npub: '', nsec: '' };
  try {
    const existing = await fs.readFile(KEYS_FILE, 'utf-8');
    const parsed = JSON.parse(existing);
    keys = { ...parsed, npub: resolveToHex(parsed.publicKey), nsec: resolveToHex(parsed.secretKey) };
  } catch {
      // no keys
  }

  const identityChoice = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Nostr Identity Management:',
      choices: [
        { name: 'Keep existing identity', value: 'keep', disabled: keys.secretKey === '' },
        { name: 'Generate new identity', value: 'generate' },
        { name: 'Import private key (nsec/hex)', value: 'import' }
      ]
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);

  if (identityChoice.action === 'generate') {
    keys = await generateNewKeyPair();
    console.log(`Generated new identity: ${keys.npub}`);
  } else if (identityChoice.action === 'import') {
    const importAnswer = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: 'Enter private key (nsec or hex):',
        mask: '*'
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    const hex = resolveToHex(importAnswer.key);
    if (hex.length !== 64) {
        console.error('Invalid key length. Using generated key instead.');
        keys = await generateNewKeyPair();
    } else {
        try {
            keys.secretKey = hex;
            keys.publicKey = getPublicKeyFromSecret(hex);
            keys.nsec = nip19.nsecEncode(Uint8Array.from(Buffer.from(hex, 'hex')));
            keys.npub = nip19.npubEncode(keys.publicKey);
            console.log(`Imported identity: ${keys.npub}`);
        } catch (error) {
            console.error('Failed to import key:', error);
            console.log('Generating new identity instead.');
            keys = await generateNewKeyPair();
        }
    }
  }

  // Save Config & Keys
  const newConfig: CLIConfig = {
    ...currentConfig,
    channels: channels,
    llm: {
      provider: String(llmAnswers.provider) as 'ollama' | 'openai' | 'anthropic',
      model: String(llmAnswers.model),
      baseUrl: llmAnswers.baseUrl !== undefined && llmAnswers.baseUrl !== '' ? String(llmAnswers.baseUrl) : undefined,
      apiKey: llmAnswers.apiKey !== undefined && llmAnswers.apiKey !== '' ? String(llmAnswers.apiKey) : undefined
    }
  };

  // 4. Permissions Configuration
  const permissionAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'admins',
      message: 'Enter Admin Pubkeys (comma separated):',
      default: (currentConfig.permissions?.admins ?? []).join(', ')
    },
    {
      type: 'input',
      name: 'users',
      message: 'Enter Trusted User Pubkeys (comma separated):',
      default: (currentConfig.permissions?.users ?? []).join(', ')
    },
    {
      type: 'input',
      name: 'agents',
      message: 'Enter Trusted Agent Pubkeys (comma separated):',
      default: (currentConfig.permissions?.agents ?? []).join(', ')
    },
    {
      type: 'list',
      name: 'policy',
      message: 'Default Policy:',
      choices: ['allow_all', 'deny_all'],
      default: currentConfig.permissions?.policy ?? 'allow_all'
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);

  const finalConfig: CLIConfig = {
    ...newConfig,
    permissions: {
      admins: permissionAnswers.admins.split(',').map((s: string) => s.trim()).filter((s: string) => s !== ''),
      users: permissionAnswers.users.split(',').map((s: string) => s.trim()).filter((s: string) => s !== ''),
      agents: permissionAnswers.agents.split(',').map((s: string) => s.trim()).filter((s: string) => s !== ''),
      policy: permissionAnswers.policy as 'allow_all' | 'deny_all'
    }
  };

  await fs.writeFile(CONFIG_FILE, JSON.stringify(finalConfig, null, 2));
  if (keys.secretKey) {
      await fs.writeFile(KEYS_FILE, JSON.stringify({
          publicKey: keys.publicKey,
          secretKey: keys.secretKey
      }, null, 2));
  }

  console.log('Configuration saved.');

  // 5. Workspace Configuration
  const workspace = new Workspace();
  await workspace.ensureExists();

  const workspaceAnswers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'editSoul',
      message: 'Do you want to edit the Agent SOUL (Persona)?',
      default: false
    },
    {
      type: 'confirm',
      name: 'editUser',
      message: 'Do you want to edit the User Profile?',
      default: false
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);

  if (workspaceAnswers.editSoul === true) {
    const soulContent = await workspace.loadFile('SOUL.md');
    const newSoul = await inquirer.prompt([
      {
        type: 'editor',
        name: 'content',
        message: 'Edit SOUL.md',
        default: soulContent
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    await workspace.saveFile('SOUL.md', newSoul.content);
  }

  if (workspaceAnswers.editUser === true) {
    const userContent = await workspace.loadFile('USER.md');
    const newUser = await inquirer.prompt([
      {
        type: 'editor',
        name: 'content',
        message: 'Edit USER.md',
        default: userContent
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    await workspace.saveFile('USER.md', newUser.content);
  }

  console.log('Workspace updated.');
  console.log('Setup complete! Run `voltclaw start` to begin.');
}
