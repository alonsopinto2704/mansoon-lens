import { useRef, useState, type DragEvent } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowRight, Download, FileSpreadsheet, UploadCloud, X } from 'lucide-react';
import { mm } from '../lib';
import { ErrorState, GateChip, PageHeader, Section, ease } from '../components/ui';

type Row = { row: number; dominant_regime: string; raw_mm: number; p10: number; p50: number; p90: number; served_mm: number; gate_status: string };

const columns = [
  ['raw_mm', 'Model rainfall, mm/day'], ['lead', 'Lead time, 1–5 days'], ['day', 'Day of year'], ['moisture', 'Moisture index'], ['wind', 'Wind index'],
  ['mslp', 'Pressure anomaly'], ['terrain_m', 'Elevation, m'], ['coast_km', 'Distance to coast, km'], ['lat', 'Latitude'], ['lon', 'Longitude'],
] as const;
const sample = `${columns.map((c) => c[0]).join(',')}\n40,1,182,0.8,0.7,-0.5,120,40,19.1,72.8\n`;

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [results, setResults] = useState<Row[]>([]);
  const input = useRef<HTMLInputElement>(null);

  function choose(f: File | null | undefined) { setFile(f ?? null); setError(null); setResults([]); }
  function onDrop(e: DragEvent) { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files[0]); }

  async function submit() {
    if (!file) return;
    setBusy(true); setError(null); setResults([]);
    const body = new FormData();
    body.append('file', file);
    try {
      const response = await fetch('/api/v1/upload', { method: 'POST', body });
      const json = await response.json();
      if (!response.ok) throw new Error(`${json.error}${json.details?.length ? `: ${json.details.join(', ')}` : ''}`);
      setResults(json.items);
    } catch (e) { setError(e instanceof Error ? e : new Error(String(e))); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <PageHeader title="Upload forecast" description="Run your own forecast rows through the trained models and see the corrected rainfall and gate decision for each." />

      <div className="upload-layout">
        <div className="card pad">
          <div className={`dropzone ${drag ? 'is-drag' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
            <input ref={input} id="forecast-csv" className="sr-only" type="file" accept=".csv,text/csv" onChange={(e) => choose(e.target.files?.[0])} />
            <AnimatePresence mode="wait" initial={false}>
              {file ? (
                <m.div key="file" className="dropzone-file" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.2, ease }}>
                  <FileSpreadsheet size={28} aria-hidden />
                  <div><strong>{file.name}</strong><small className="muted block">{(file.size / 1024).toFixed(1)} KB</small></div>
                  <button className="icon-btn" aria-label="Remove file" onClick={() => { choose(null); if (input.current) input.current.value = ''; }}><X size={16} /></button>
                </m.div>
              ) : (
                <m.div key="empty" className="dropzone-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <m.span className="dropzone-icon" animate={drag ? { y: -4, scale: 1.08 } : { y: 0, scale: 1 }}><UploadCloud size={26} aria-hidden /></m.span>
                  <strong>Drop a CSV file here</strong>
                  <p className="muted small">Up to 1,000 rows and 2 MB</p>
                  <label className="btn btn-secondary" htmlFor="forecast-csv">Choose file</label>
                </m.div>
              )}
            </AnimatePresence>
          </div>
          <button className="btn btn-primary btn-block" disabled={!file || busy} onClick={submit}>
            {busy ? <><span className="spinner" aria-hidden /> Processing…</> : <>Run correction <ArrowRight size={16} aria-hidden /></>}
          </button>
          {error && <div className="mt"><ErrorState error={error} /></div>}
        </div>

        <div className="card pad">
          <h3>File format</h3>
          <p className="muted small">One forecast per row, all columns numeric, with a header row.</p>
          <dl className="schema">
            {columns.map(([key, desc]) => <div key={key}><dt><code>{key}</code></dt><dd>{desc}</dd></div>)}
          </dl>
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(sample)}`} download="monsoonlens-sample.csv" className="link"><Download size={14} aria-hidden /> Download a sample file</a>
        </div>
      </div>

      {results.length > 0 && (
        <m.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
          <Section title="Results" description={`${results.length} row${results.length === 1 ? '' : 's'} processed. The gate decides whether the corrected or raw value is served.`}>
            <div className="card table-card">
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Row</th><th>Regime</th><th className="align-right">Raw</th><th className="align-right">Low · Median · High</th><th className="align-right">Served</th><th>Correction</th></tr></thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.row}><td className="num">{r.row}</td><td>{r.dominant_regime}</td><td className="num align-right">{mm(r.raw_mm)}</td><td className="num align-right">{[r.p10, r.p50, r.p90].map((x) => x.toFixed(1)).join(' · ')} mm</td><td className="num align-right"><strong>{mm(r.served_mm)}</strong></td><td><GateChip status={r.gate_status} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>
        </m.div>
      )}
    </div>
  );
}
