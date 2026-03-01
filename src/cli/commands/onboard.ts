import inquirer from 'inquirer';
import { Workspace } from '../../core/workspace.js';

export async function onboardCommand(): Promise<void> {
  console.log('VoltClaw Onboarding - Design Your Agent Persona\n');

  const workspace = new Workspace();
  await workspace.ensureExists();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'What is your agent\'s name?',
      default: 'VoltClaw'
    },
    {
      type: 'input',
      name: 'role',
      message: 'What is its primary role?',
      default: 'A helpful autonomous coding assistant'
    },
    {
      type: 'list',
      name: 'tone',
      message: 'What is its personality/tone?',
      choices: ['Professional', 'Friendly', 'Sarcastic', 'Technical', 'Robot'],
      default: 'Professional'
    },
    {
      type: 'input',
      name: 'user',
      message: 'What should it call you?',
      default: 'User'
    }
  ]);

  const systemPrompt = `You are ${answers.name}.
Role: ${answers.role}
Tone: ${answers.tone}

You are assisting ${answers.user}.

TOOLS:
{tools}
{rlmGuide}
CONSTRAINTS:
- Budget: {budget}
- Max Depth: {maxDepth}
- Current Depth: {depth}
{depthWarning}

You are persistent, efficient, and recursive.`;

  await workspace.saveFile('SYSTEM_PROMPT.md', systemPrompt);

  // Also save user profile
  const userProfile = `Name: ${answers.user}\nRole: Administrator`;
  await workspace.saveFile('USER.md', userProfile);

  console.log(`\nPersona saved! ${answers.name} is ready.`);
}
