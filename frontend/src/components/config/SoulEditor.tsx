import { useState, useEffect, useCallback } from 'react';
import MDEditor from '@uiw/react-md-editor';
import './SoulEditor.css';

/** Role display name mapping */
const ROLE_LABELS: Record<string, string> = {
  speaker:         '🏛️ 议长 Speaker',
  radical_mp:      '🔥 激进派 Radical MP',
  conservative_mp: '🛡️ 保守派 Conservative MP',
  president:       '👔 总统 President',
  sec_state:       '📜 国务卿 Sec. State',
  sec_engineering: '⚙️ 工程部长 Sec. Engineering',
  chief_justice:   '⚖️ 首席大法官 Chief Justice',
  SOUL_TEMPLATE:   '📄 模板 Template',
};

function getRoleLabel(name: string): string {
  return ROLE_LABELS[name] ?? name;
}

interface SoulListItem {
  name: string;
  label: string;
}

export function SoulEditor() {
  const [souls, setSouls] = useState<SoulListItem[]>([]);
  const [selectedSoul, setSelectedSoul] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const baseUrl = '/api';

  // Fetch soul list
  useEffect(() => {
    fetch(`${baseUrl}/config/souls`)
      .then((res) => res.json())
      .then((data: { souls: string[] }) => {
        const items: SoulListItem[] = data.souls.map((name) => ({
          name,
          label: getRoleLabel(name),
        }));
        // Sort with SOUL_TEMPLATE last
        items.sort((a, b) => {
          if (a.name === 'SOUL_TEMPLATE') return 1;
          if (b.name === 'SOUL_TEMPLATE') return -1;
          return a.label.localeCompare(b.label);
        });
        setSouls(items);
        // Auto-select the first soul
        if (items.length > 0 && !selectedSoul) {
          setSelectedSoul(items[0].name);
        }
      })
      .catch((err) => console.error('[SoulEditor] Failed to fetch soul list:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch selected soul content
  useEffect(() => {
    if (!selectedSoul) return;
    setLoading(true);
    setSaveMessage(null);
    fetch(`${baseUrl}/config/souls/${selectedSoul}`)
      .then((res) => res.json())
      .then((data: { name: string; content: string }) => {
        setContent(data.content);
        setOriginalContent(data.content);
      })
      .catch((err) => console.error('[SoulEditor] Failed to fetch soul content:', err))
      .finally(() => setLoading(false));
  }, [selectedSoul]);

  const hasChanges = content !== originalContent;

  const handleSave = useCallback(async () => {
    if (!selectedSoul || !hasChanges) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(`${baseUrl}/config/souls/${selectedSoul}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setOriginalContent(content);
      setSaveMessage({ type: 'success', text: '✅ 已保存，缓存已刷新。下次 Agent 调用将使用新人设。' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setSaveMessage({ type: 'error', text: `❌ 保存失败: ${msg}` });
    } finally {
      setSaving(false);
    }
  }, [selectedSoul, content, hasChanges]);

  // Keyboard shortcut: Ctrl/Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  return (
    <div className="soul-editor" data-color-mode="dark">
      {/* Sidebar */}
      <aside className="soul-sidebar">
        <div className="soul-sidebar-header">
          <h3>🧬 Agent 人设</h3>
          <span className="soul-count">{souls.length} files</span>
        </div>
        <ul className="soul-list">
          {souls.map((soul) => (
            <li
              key={soul.name}
              className={`soul-list-item ${selectedSoul === soul.name ? 'active' : ''}`}
              onClick={() => setSelectedSoul(soul.name)}
            >
              <span className="soul-list-label">{soul.label}</span>
              <span className="soul-list-filename">{soul.name}.md</span>
            </li>
          ))}
        </ul>
      </aside>

      {/* Main Editor */}
      <main className="soul-main">
        {/* Toolbar */}
        <div className="soul-toolbar">
          <div className="soul-toolbar-left">
            {selectedSoul && (
              <>
                <span className="soul-toolbar-icon">📝</span>
                <span className="soul-toolbar-filename">{selectedSoul}.md</span>
                {hasChanges && <span className="soul-unsaved-badge">● 未保存</span>}
              </>
            )}
          </div>
          <div className="soul-toolbar-right">
            {saveMessage && (
              <span className={`soul-save-message ${saveMessage.type}`}>
                {saveMessage.text}
              </span>
            )}
            <button
              className="soul-save-btn"
              onClick={handleSave}
              disabled={!hasChanges || saving}
            >
              {saving ? '保存中…' : '💾 保存 (⌘S)'}
            </button>
          </div>
        </div>

        {/* Editor Area */}
        <div className="soul-editor-area">
          {loading ? (
            <div className="soul-loading">
              <div className="soul-loading-spinner" />
              <span>加载中…</span>
            </div>
          ) : selectedSoul ? (
            <MDEditor
              value={content}
              onChange={(val) => setContent(val || '')}
              height="100%"
              visibleDragbar={false}
              preview="live"
            />
          ) : (
            <div className="soul-empty">
              <span className="soul-empty-icon">🧬</span>
              <p>选择左侧角色以编辑其人设文件</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
