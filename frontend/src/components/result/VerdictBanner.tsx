import React from 'react';
import './Result.css';

interface VerdictBannerProps {
  constitutional: boolean;
  ruling: string;
  evidence: string[];
}

export const VerdictBanner: React.FC<VerdictBannerProps> = ({ 
  constitutional, 
  ruling, 
  evidence 
}) => {
  return (
    <div className={`verdict-banner ${constitutional ? 'constitutional' : 'unconstitutional'}`}>
      <div className="verdict-header">
        <span className="verdict-icon">{constitutional ? '✅' : '❌'}</span>
        <h2 className="verdict-title">
          {constitutional ? 'CONSTITUTIONAL' : 'UNCONSTITUTIONAL'}
        </h2>
      </div>
      
      <div className="verdict-ruling">
        {ruling}
      </div>

      {!constitutional && evidence && evidence.length > 0 && (
        <ul className="verdict-evidence">
          {evidence.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
