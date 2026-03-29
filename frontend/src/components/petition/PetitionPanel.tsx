import { useState, ChangeEvent, FormEvent } from 'react';
import { useAppDispatch, useAppState } from '../../contexts/AppContext';
import { useApi } from '../../hooks/useApi';
import './PetitionPanel.css';

const TEMPLATES = [
  '📝 帮我写一个 TODO App',
  '🔍 搜索 Rust async 最新进展',
  '⚠️ 危险测试: rm -rf /tmp/test',
  '🧮 用 Python 计算斐波那契数列前 20 项'
];

export function PetitionPanel() {
  const dispatch = useAppDispatch();
  const { petition } = useAppState();
  const { postPetition } = useApi();
  
  const [prompt, setPrompt] = useState(petition.prompt || '');
  
  const charCount = prompt.length;
  const isInvalidLength = charCount > 0 && (charCount < 10 || charCount > 20000);
  const isSubmitDisabled = charCount < 10 || charCount > 20000 || petition.status === 'submitting';

  const handleTemplateClick = (template: string) => {
    // Remove the emoji prefix for the actual prompt
    const cleanPrompt = template.substring(template.indexOf(' ') + 1);
    setPrompt(cleanPrompt);
  };

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitDisabled) return;

    dispatch({ type: 'PETITION_SUBMIT', prompt });

    try {
      const response = await postPetition(prompt);
      dispatch({ type: 'PETITION_SUCCESS', taskId: response.task_id });
      setPrompt(''); // Optional: clear prompt on success
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit petition';
      dispatch({ type: 'PETITION_ERROR', error: errorMessage });
    }
  };

  return (
    <div className="petition-panel">
      <div className="petition-header">
        <h2>Submit Petition</h2>
        <p>Propose a new task to the Trias system.</p>
      </div>

      <form className="petition-form" onSubmit={handleSubmit}>
        <div className="templates-section">
          <span className="templates-label">Quick Templates</span>
          <div className="templates-list">
            {TEMPLATES.map((template, idx) => (
              <button
                key={idx}
                type="button"
                className="template-bubble"
                onClick={() => handleTemplateClick(template)}
              >
                {template}
              </button>
            ))}
          </div>
        </div>

        <div className="textarea-wrapper">
          <textarea
            className="petition-textarea"
            placeholder="Describe your request in detail (min 10 characters)..."
            value={prompt}
            onChange={handleTextChange}
            disabled={petition.status === 'submitting'}
          />
          <div className={`char-counter ${isInvalidLength ? 'invalid' : ''}`}>
            {charCount} / 20000
          </div>
        </div>

        {petition.status === 'error' && petition.error && (
          <div className="error-message">
            {petition.error}
          </div>
        )}
        
        {petition.status === 'submitted' && petition.taskId && (
          <div className="success-message">
            Petition accepted! Task ID: {petition.taskId.split('-')[0]}...
          </div>
        )}

        <button 
          type="submit" 
          className="submit-btn" 
          disabled={isSubmitDisabled}
        >
          {petition.status === 'submitting' ? (
            <>
              <div className="spinner" />
              Submitting...
            </>
          ) : (
            'Submit to Trias'
          )}
        </button>
      </form>
    </div>
  );
}
