import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { ACCEPTED_EXT } from './fileParser';

const FileDropzone = ({ onFile, busy }) => {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const pick = (file) => { if (file) onFile(file); };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
      onClick={() => !busy && inputRef.current?.click()}
      className="rounded-2xl p-10 text-center cursor-pointer transition-all"
      style={{
        border: `2px dashed ${drag ? 'var(--color-primary-500)' : 'var(--color-border)'}`,
        backgroundColor: drag ? 'var(--color-primary-50)' : 'var(--color-surface)',
        opacity: busy ? 0.6 : 1,
      }}>
      <input ref={inputRef} type="file" accept={ACCEPTED_EXT.join(',')} className="hidden"
        onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <UploadCloud size={26} className="text-white" />
      </div>
      <p className="font-bold" style={{ color: 'var(--color-text)' }}>
        {busy ? 'Reading file…' : 'Drop your CSV / Excel file here'}
      </p>
      <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>or click to browse · .csv, .xlsx · max 2000 rows</p>
    </div>
  );
};

export default FileDropzone;
