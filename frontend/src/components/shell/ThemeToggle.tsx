import { useTheme } from '../../theme/useTheme';
import { IconButton } from '../ui/IconButton';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return <IconButton label={`Switch to the ${next} theme`} icon="moon" onClick={toggleTheme} />;
}
