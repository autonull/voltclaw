import inquirer from 'inquirer';

export async function askApproval(tool: string, args: unknown): Promise<boolean> {
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  const DESTRUCTIVE = ['execute', 'write_file', 'edit', 'delete', 'call', 'call_parallel'];
  // We might want to approve recursive calls too? Or maybe not 'call'.
  // But 'execute' is definitely destructive.
  // Let's stick to the list from oneShotQuery for now, plus maybe 'call' if user wants full control.
  // Actually, 'call' is recursive, but not inherently destructive unless the child does something destructive.
  // The user probably wants to approve file modifications and shell commands.

  const DANGEROUS = ['execute', 'write_file', 'edit', 'delete'];

  if (!DANGEROUS.includes(tool)) return true;

  console.log(`\n⚠️  Tool Approval Required:`);
  console.log(`   Tool: ${tool}`);
  console.log(`   Args: ${JSON.stringify(args, null, 2)}`);

  try {
    const { allowed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'allowed',
        message: 'Allow execution?',
        default: false
      }
    ]);
    return allowed;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // If prompt fails (e.g. stream closed), default to false
    return false;
  }
}
