import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, RefreshCw, Smartphone } from 'lucide-react';
import { api, describeError } from '../api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { OfflineCard } from '../components/Offline';
import { Page } from '../components/Page';
import type { Pairing } from '../types';

/** qrcode emits hard-coded fills; repaint with currentColor so the token colours (via CSS) win. */
function tintSvg(svg: string): string {
  return svg.replace(/fill="#[0-9a-fA-F]+"/g, 'fill="none"').replace(/stroke="#[0-9a-fA-F]+"/g, 'stroke="currentColor"');
}

export function Pair() {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [svg, setSvg] = useState<string>('');
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      setPairing(await api.get<Pairing>('/api/pairing'));
    } catch (e) {
      setLoadError(e);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!pairing) return;
    let live = true;
    QRCode.toString(pairing.qr_payload, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      .then((s) => live && setSvg(tintSvg(s)))
      .catch(() => live && setSvg(''));
    return () => {
      live = false;
    };
  }, [pairing]);

  async function rotate() {
    setRotating(true);
    setRotateError(null);
    try {
      await api.post('/api/pairing/rotate');
      setPairing(await api.get<Pairing>('/api/pairing'));
      setConfirming(false);
    } catch (e) {
      setRotateError(describeError(e, '沒有換成功，原本的配對碼還能用，請再試一次。'));
    } finally {
      setRotating(false);
    }
  }

  return (
    <Page zh="配對手機" en="Pair" lede="讓手機上的好記連到這台主機。錄音和逐字稿仍然只留在手機上。">
      {loadError && !pairing ? <OfflineCard onRetry={() => void load()} error={loadError} /> : null}
      {pairing && (
        <>
          <Card>
            <div className="pair-grid">
              <div className="qr" role="img" aria-label="配對 QR code，用手機相機掃描" style={{ color: 'var(--heading)' }}>
                {/* Safe: the SVG comes from the qrcode encoder (rects/paths only); the payload is encoded as
                    modules, never inserted as text or attributes. */}
                {svg && <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: svg }} />}
              </div>
              <div className="card-body" style={{ gap: 20 }}>
                <h2 className="section-title">
                  <Smartphone size={18} strokeWidth={1.8} aria-hidden style={{ verticalAlign: '-3px', marginRight: 8, color: 'var(--muted)' }} />
                  掃描就能連上
                </h2>
                <ol className="steps">
                  <Step n={1}>在手機上裝好好記。</Step>
                  <Step n={2}>用手機相機掃描，好記會自動打開並連上這台主機。</Step>
                  <Step n={3}>看到「已連上」就可以開始錄音。</Step>
                </ol>
                <p className="small muted">QR code 裡有配對碼，只給你信任的人掃。</p>
              </div>
            </div>
          </Card>

          <Card title="手機連得到的位址" labelledBy="pair-urls" action={<span className="small muted">掃不了時，在好記的設定裡手動輸入</span>}>
            <div className="card-body">
              {pairing.urls.map((u) => (
                <CopyRow key={u} value={u} label={`複製 ${u}`} />
              ))}
              {pairing.urls.length === 0 && <p className="muted">找不到對外的位址。在 .env 設定 HAOJI_PUBLIC_URLS 後重新啟動。</p>}
              <p className="field-label" style={{ marginTop: 8 }}>
                配對碼
              </p>
              <CopyRow value={pairing.token} label="複製配對碼" />
            </div>
          </Card>

          <Card title="換一組配對碼" icon={RefreshCw} labelledBy="pair-rotate">
            <div className="card-body">
              {confirming ? (
                <div className="notice" style={{ alignItems: 'center' }}>
                  <div className="grow">
                    <p className="notice-title">換掉配對碼？</p>
                    <p className="muted">已配對的手機要重新掃描才能連線。手機上的錄音和會議記錄不受影響。</p>
                  </div>
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={rotating}>
                    取消
                  </Button>
                  <Button variant="primary" onClick={() => void rotate()} disabled={rotating}>
                    {rotating ? '更換中…' : '換掉'}
                  </Button>
                </div>
              ) : (
                <div className="row">
                  <p className="muted grow">覺得配對碼外流了，或想讓舊手機斷線時使用。</p>
                  <Button icon={RefreshCw} onClick={() => setConfirming(true)}>
                    換一組配對碼
                  </Button>
                </div>
              )}
              {rotateError && (
                <p className="inline-error" role="alert">
                  {rotateError}
                </p>
              )}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}

function Step({ n, children }: { n: number; children: string }) {
  return (
    <li>
      <span className="step-n num" aria-hidden>
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (http origin): the text is selectable */
    }
  }

  return (
    <div className="url-row">
      <span className="mono grow" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>
        {value}
      </span>
      {copied && (
        <span className="small row" style={{ color: 'var(--primaryDark)', gap: 4 }} role="status">
          <Check size={14} strokeWidth={2} aria-hidden />
          已複製
        </span>
      )}
      <Button size="sm" variant="ghost" icon={Copy} aria-label={label} title="複製" onClick={() => void copy()} />
    </div>
  );
}
