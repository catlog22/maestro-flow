import { execSync } from 'node:child_process';

export function openTerminalWindow(sessionName: string, title: string): void {
  const platform = process.platform;

  if (platform === 'win32') {
    openWindowsTerminal(sessionName, title);
  } else if (platform === 'darwin') {
    openMacTerminal(sessionName, title);
  } else {
    openLinuxTerminal(sessionName, title);
  }
}

function openWindowsTerminal(sessionName: string, title: string): void {
  try {
    execSync(
      `wt -w 0 new-tab --title "${title}" rmux attach -t "${sessionName}"`,
      { stdio: 'ignore', timeout: 5000 },
    );
  } catch {
    try {
      execSync(
        `start "rmux: ${title}" cmd /k rmux attach -t "${sessionName}"`,
        { stdio: 'ignore', shell: 'cmd.exe', timeout: 5000 },
      );
    } catch {}
  }
}

function openMacTerminal(sessionName: string, title: string): void {
  const script = `
    tell application "Terminal"
      do script "rmux attach -t '${sessionName}'"
      set custom title of front window to "${title}"
      activate
    end tell
  `;
  try {
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { stdio: 'ignore', timeout: 5000 });
  } catch {}
}

function openLinuxTerminal(sessionName: string, title: string): void {
  const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'];
  for (const term of terminals) {
    try {
      if (term === 'gnome-terminal') {
        execSync(`${term} --title="${title}" -- rmux attach -t "${sessionName}"`, { stdio: 'ignore', timeout: 5000 });
      } else if (term === 'konsole') {
        execSync(`${term} --new-tab -e rmux attach -t "${sessionName}"`, { stdio: 'ignore', timeout: 5000 });
      } else {
        execSync(`${term} -T "${title}" -e "rmux attach -t '${sessionName}'" &`, { stdio: 'ignore', timeout: 5000 });
      }
      return;
    } catch { continue; }
  }
}
