import { useState } from 'react';
import { Download, FileSpreadsheet, CheckCircle2, Info, Building2, ChevronDown } from 'lucide-react';
import { sampleTemplateCsv } from './columnMapping';

const FileRequirementsGuide = ({ reference = [], fields = [], formFields = [], phoneKey = null }) => {
  const [showNames, setShowNames] = useState(false);
  const required = fields.filter(f => f.required);
  const optional = fields.filter(f => !f.required);

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + sampleTemplateCsv(formFields, phoneKey)], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'bulk_transfer_template.csv' });
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
              <FileSpreadsheet size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Before you upload</h3>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                Columns below are built from your live form configuration — new form fields appear here automatically.
              </p>
            </div>
          </div>
          <button onClick={downloadTemplate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm text-white transition-all hover:scale-[1.02]"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
            <Download size={16} /> Download sample template
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-secondary)' }}>Required columns</p>
            <div className="space-y-1.5">
              {required.map(f => (
                <div key={f.key} className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-success-600)' }} />
                  <div>
                    <code className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{f.key}</code>
                    {f.isPhone && <span className="text-[10px] ml-1.5 px-1 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>CLI</span>}
                    {f.desc && <span className="text-xs ml-1.5" style={{ color: 'var(--color-text-secondary)' }}>— {f.desc}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-secondary)' }}>Optional columns ({optional.length})</p>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {optional.map(f => (
                <div key={f.key} className="flex items-start gap-2">
                  <Info size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                  <div>
                    <code className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{f.key}</code>
                    {f.desc && <span className="text-xs ml-1.5" style={{ color: 'var(--color-text-secondary)' }}>— {f.desc}</span>}
                  </div>
                </div>
              ))}
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Any extra columns are saved as custom fields.</p>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl p-3 text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
          <strong>Rules:</strong> CSV or Excel (.xlsx) · up to 2000 rows · no empty rows · no merged cells ·
          <code className="mx-1">fronter_name</code> and <code className="mx-1">company_name</code> must match existing records exactly (see valid names below).
        </div>
      </div>

      {/* Live valid names so the superadmin types names that resolve cleanly. */}
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <button onClick={() => setShowNames(s => !s)} className="w-full flex items-center justify-between p-4">
          <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--color-text)' }}>
            <Building2 size={16} style={{ color: 'var(--color-primary-600)' }} /> Valid company &amp; fronter names ({reference.length} companies)
          </span>
          <ChevronDown size={18} className="transition-transform" style={{ color: 'var(--color-text-tertiary)', transform: showNames ? 'rotate(180deg)' : 'none' }} />
        </button>
        {showNames && (
          <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {reference.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No companies found.</p>
            ) : reference.map(co => (
              <div key={co.id} className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{co.name}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {co.fronters.length ? co.fronters.map(f => f.name).join(' · ') : <em>No fronters</em>}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileRequirementsGuide;
