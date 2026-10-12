import { createRoot } from 'react-dom/client';
import TodoApp from './TodoApp';
import UpdatePrompt from './UpdatePrompt';
import './globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('拾光记事页面容器缺失');
createRoot(root).render(<><TodoApp /><UpdatePrompt /></>);
