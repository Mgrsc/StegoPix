import { useState, useEffect } from 'react';
import { Upload, Image as ImageIcon, Type, FileDigit, Download, ShieldCheck, Sparkles, X, Layers, Command, CheckCircle2, HelpCircle } from 'lucide-react';

const generateShortUUID = () => {
  return Math.random().toString(36).substring(2, 10);
};

const parseFilenameParams = (filename) => {
  const result = { pwd_img: null, pwd_wm: null, width: null, height: null, length: null, type: null };

  const pwdMatch = filename.match(/^pwd(\d+)-(\d+)_/);
  if (pwdMatch) {
    result.pwd_img = parseInt(pwdMatch[1]);
    result.pwd_wm = parseInt(pwdMatch[2]);
  }

  const dimMatch = filename.match(/_(\d+)x(\d+)_/);
  if (dimMatch) {
    result.width = parseInt(dimMatch[1]);
    result.height = parseInt(dimMatch[2]);
    result.type = 'image';
  }

  const lenMatch = filename.match(/_L(\d+)_/);
  if (lenMatch) {
    result.length = parseInt(lenMatch[1]);
    result.type = 'text';
  }

  return result;
};

export default function App() {
  const [config, setConfig] = useState({ auth_required: false, max_files: 5 });
  const [token, setToken] = useState(localStorage.getItem('stego_token') || '');
  const [isAuth, setIsAuth] = useState(false);
  const [mode, setMode] = useState('embed'); 
  const [type, setType] = useState('text'); 
  
  const [files, setFiles] = useState({ source: [], wm: null });
  const [params, setParams] = useState({ text: '', width: 0, height: 0, length: 0, pwd_img: 1, pwd_wm: 1 });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoFillInfo, setAutoFillInfo] = useState('');
  const [autoResizing, setAutoResizing] = useState(false);

  const AUTO_RESIZE_SCALE = 0.85;

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setConfig(data);
        if (!data.auth_required) setIsAuth(true);
        else if (token) setIsAuth(true);
      })
      .catch(() => setError("Cannot connect to server"));
  }, []);

  const handleAuth = () => {
    if (token) {
      localStorage.setItem('stego_token', token);
      setIsAuth(true);
    }
  };

  const handleSourceChange = (e) => {
    const selected = Array.from(e.target.files);

    if (selected.length === 0) return;

    if (selected.length > config.max_files) {
      setError(`Limit exceeded: Max ${config.max_files} images.`);
      return;
    }
    setError('');
    setAutoFillInfo('');
    setFiles({ ...files, source: selected });

    if (mode === 'extract' && selected.length > 0) {
      const parsed = parseFilenameParams(selected[0].name);
      const updates = {};
      let autoFilled = [];

      if (parsed.pwd_img !== null) {
        updates.pwd_img = parsed.pwd_img;
        autoFilled.push(`IMAGE KEY: ${parsed.pwd_img}`);
      }
      if (parsed.pwd_wm !== null) {
        updates.pwd_wm = parsed.pwd_wm;
        autoFilled.push(`WATERMARK KEY: ${parsed.pwd_wm}`);
      }
      if (parsed.type === 'image' && parsed.width && parsed.height) {
        updates.width = parsed.width;
        updates.height = parsed.height;
        autoFilled.push(`Size: ${parsed.width}x${parsed.height}`);
        if (type !== 'image') setType('image');
      } else if (parsed.length !== null) {
        updates.length = parsed.length;
        autoFilled.push(`Length: ${parsed.length}`);
        if (type === 'image') setType('text');
      }

      if (Object.keys(updates).length > 0) {
        setParams(prev => ({ ...prev, ...updates }));
        setAutoFillInfo(`Auto-filled: ${autoFilled.join(', ')}`);
      }
    }
  };

  const handleWatermarkChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setFiles({ ...files, wm: selected });
    }
  };

  const resizeImageFile = (file, scaleFactor) => {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No watermark selected.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const newWidth = Math.max(1, Math.floor(img.width * scaleFactor));
          const newHeight = Math.max(1, Math.floor(img.height * scaleFactor));
          if (newWidth === img.width && newHeight === img.height) {
            resolve({ file, width: img.width, height: img.height });
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = newWidth;
          canvas.height = newHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, newWidth, newHeight);
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Failed to shrink watermark.'));
              return;
            }
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            const newFile = new File([blob], `${baseName}_scaled.png`, { type: 'image/png' });
            resolve({ file: newFile, width: newWidth, height: newHeight });
          }, 'image/png', 0.92);
        };
        img.onerror = () => reject(new Error('Unable to read watermark image.'));
        img.src = ev.target.result;
      };
      reader.onerror = () => reject(new Error('Unable to load watermark image.'));
      reader.readAsDataURL(file);
    });
  };

  const handleAutoResizeWatermark = async () => {
    if (!files.wm || autoResizing) return;
    setAutoResizing(true);
    try {
      const resized = await resizeImageFile(files.wm, AUTO_RESIZE_SCALE);
      setFiles(prev => ({ ...prev, wm: resized.file }));
      setError(`Watermark auto-resized to approximately ${resized.width}x${resized.height}. Please run again.`);
    } catch (err) {
      setError(err.message || 'Automatic resize failed. Please resize manually.');
    } finally {
      setAutoResizing(false);
    }
  };

  const removeSource = (index) => {
    const newSources = files.source.filter((_, i) => i !== index);
    setFiles({ ...files, source: newSources });
  };

  const downloadAllImages = async () => {
    const imageResults = results.filter(res => res.image);
    if (imageResults.length === 0) return;
    for (let i = 0; i < imageResults.length; i++) {
      const res = imageResults[i];
      const link = document.createElement('a');
      link.href = res.image;
      link.download = generateDownloadFilename(res, i);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      if (i < imageResults.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  };

  const generateDownloadFilename = (res, idx) => {
    const shortUUID = generateShortUUID();

    if (mode === 'embed') {
      if (type === 'image' && res.wm_width && res.wm_height) {
        
        return `pwd${params.pwd_img}-${params.pwd_wm}_${res.wm_width}x${res.wm_height}_${shortUUID}.png`;
      } else if (res.wm_length) {
        
        return `pwd${params.pwd_img}-${params.pwd_wm}_L${res.wm_length}_${shortUUID}.png`;
      }
    }
    return `stego_${idx}_${shortUUID}.png`;
  };

  const submit = async () => {
    if (files.source.length === 0) {
      setError("Source image is required.");
      return;
    }

    setLoading(true);
    setResults([]);
    setError('');
    setAutoFillInfo('');
    
    const formData = new FormData();
    files.source.forEach(file => formData.append('source', file));
    formData.append('pwd_img', params.pwd_img);
    formData.append('pwd_wm', params.pwd_wm);

    let endpoint = `/api/${mode}/${type}`;
    
    if (mode === 'embed') {
      if (type === 'text') formData.append('text', params.text);
      else if (type === 'image') formData.append('watermark', files.wm);
      else if (type === 'bytes') formData.append('binary_file', files.wm);
    } else {
      if (type === 'image') {
        formData.append('wm_width', params.width);
        formData.append('wm_height', params.height);
      } else {
        formData.append('wm_length', params.length);
      }
    }

    try {
      const headers = config.auth_required ? { 'Authorization': `Bearer ${token}` } : {};
      const res = await fetch(endpoint, { method: 'POST', headers, body: formData });

      if (res.status === 401) {
        setIsAuth(false);
        localStorage.removeItem('stego_token');
        setError("Authentication failed. Please login again.");
      } else if (!res.ok) {
        try {
          const err = await res.json();
          setError(err.detail || `Server error (${res.status}): Operation failed`);
        } catch {
          setError(`Server error (${res.status}): Unable to parse response`);
        }
      } else {
        const data = await res.json();
        setResults(Array.isArray(data) ? data : [data]);
      }
    } catch (e) {
      if (e.name === 'TypeError' && e.message.includes('fetch')) {
        setError("Network connection error: Unable to reach server");
      } else {
        setError(`Unexpected error: ${e.message || 'Unknown error occurred'}`);
      }
    }
    setLoading(false);
  };

  if (!isAuth && config.auth_required) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-5 sm:p-7 shadow-2xl ring-4 ring-[#d97757]/10">
          <div className="mb-3 sm:mb-4 flex justify-center text-[#d97757]">
             <ShieldCheck size={36} className="sm:hidden" strokeWidth={1.5} />
             <ShieldCheck size={44} className="hidden sm:block" strokeWidth={1.5} />
          </div>
          <h2 className="mb-3 sm:mb-4 text-center text-base sm:text-lg font-bold text-stone-800">Secured Access</h2>
          <input
            type="password"
            className="mb-3 w-full rounded-md border-2 border-stone-200 bg-stone-50 px-3 py-2.5 sm:py-2 text-center text-sm font-medium outline-none transition-all focus:border-[#d97757] focus:bg-white focus:ring-4 focus:ring-[#d97757]/20"
            placeholder="Enter Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button onClick={handleAuth} className="w-full rounded-md bg-[#d97757] py-3 sm:py-2.5 text-sm font-bold text-white shadow-lg transition-transform hover:-translate-y-1 hover:bg-[#bf6244] active:translate-y-0 active:scale-[0.98]">
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen justify-center bg-[#ebe9e5] p-3 sm:p-6 md:p-12 lg:p-16">

      <div className="grid w-full max-w-6xl grid-cols-1 gap-4 sm:gap-6 lg:gap-8 lg:grid-cols-12 items-start">

        
        
        <div className="animate-slide-up lg:col-span-7">
          
          <div className="rounded-2xl bg-white border-2 border-stone-200 shadow-card h-fit">

        
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b-2 border-stone-100 px-4 sm:px-6 py-4 sm:py-5">
              <div className="flex items-center gap-3 sm:gap-4">

                <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-[#d97757] text-white shadow-lg shadow-[#d97757]/30">
                  <Sparkles size={24} className="sm:hidden" fill="white" />
                  <Sparkles size={28} className="hidden sm:block" fill="white" />
                </div>

                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-stone-800">StegoPix</h1>
              </div>

              <div className="flex rounded-lg bg-stone-100 p-1 sm:p-1.5 ring-1 ring-stone-200">
                {['embed', 'extract'].map(m => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setResults([]); setError(''); setAutoFillInfo(''); setFiles({ source: [], wm: null }); }}

                    className={`rounded-md px-4 sm:px-6 py-1.5 sm:py-2 text-xs sm:text-sm font-bold uppercase tracking-wide transition-all duration-200 ${mode === m ? 'bg-white text-[#d97757] shadow-md translate-y-[-1px]' : 'text-stone-400 hover:text-stone-600'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 sm:p-6">

              <div className="mb-4 sm:mb-6 grid grid-cols-3 gap-2 sm:gap-4">
                {[{id:'text', Icon: Type, label:'Text'}, {id:'image', Icon: ImageIcon, label:'Image'}, {id:'bytes', Icon: FileDigit, label:'Bytes'}].map(({id, Icon, label}) => (
                  <button
                    key={id}
                    onClick={() => { setType(id); setResults([]); }}

                    className={`group relative flex flex-col items-center gap-2 sm:gap-3 rounded-xl border-2 py-3 sm:py-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover ${type === id ? 'border-[#d97757] bg-[#d97757]/5 text-[#d97757]' : 'border-stone-100 bg-stone-50 text-stone-400 hover:border-[#d97757]/50 hover:bg-white'}`}
                  >

                    <Icon size={24} className="sm:hidden" strokeWidth={type === id ? 2.5 : 2} />
                    <Icon size={32} className="hidden sm:block" strokeWidth={type === id ? 2.5 : 2} />
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest">{label}</span>
                    {type === id && <div className="absolute right-1.5 top-1.5 sm:right-2 sm:top-2 text-[#d97757]"><CheckCircle2 size={14} className="sm:hidden" /><CheckCircle2 size={16} className="hidden sm:block" /></div>}
                  </button>
                ))}
              </div>

              {error && (
                <div className="mb-5 animate-scale space-y-3 rounded-lg border-2 border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-red-200 p-1"><X size={14} /></div>
                    <span>{error}</span>
                  </div>
                  {mode === 'embed' && type === 'image' && files.wm && error?.toLowerCase().includes('watermark image resolution too large') && (
                    <button
                      onClick={handleAutoResizeWatermark}
                      disabled={autoResizing}
                      className="w-full rounded-md bg-[#d97757] px-3 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-[#bf6244] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {autoResizing ? 'Resizing...' : 'Auto-resize watermark & retry'}
                    </button>
                  )}
                </div>
              )}

              {autoFillInfo && (
                <div className="mb-5 animate-scale rounded-lg border-2 border-green-200 bg-green-50 p-3 text-sm font-medium text-green-700">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-green-200 p-1"><CheckCircle2 size={14} /></div>
                    <span>{autoFillInfo}</span>
                  </div>
                </div>
              )}

              
              <div className="space-y-4 sm:space-y-5">

                <div className={`relative flex flex-col items-center justify-center rounded-xl sm:rounded-2xl border-2 border-dashed py-6 sm:py-10 transition-all duration-300 ${files.source.length > 0 ? 'border-[#d97757] bg-[#d97757]/5' : 'border-stone-300 bg-stone-50 hover:border-[#d97757] hover:bg-white'}`}>

                  <div className={`mb-2 sm:mb-3 rounded-full p-2.5 sm:p-3.5 shadow-sm transition-transform duration-300 group-hover:scale-110 ${files.source.length > 0 ? 'bg-white text-[#d97757]' : 'bg-stone-200 text-stone-500'}`}>
                    <Layers size={28} className="sm:hidden" />
                    <Layers size={40} className="hidden sm:block" />
                  </div>

                  <p className="text-base sm:text-lg font-bold text-stone-700 text-center px-4">
                    {files.source.length > 0 ? `${files.source.length} Files Selected` : "Drag & Drop Source Images"}
                  </p>
                  <p className="mt-1 text-[10px] sm:text-xs font-medium text-stone-400">Max {config.max_files} files supported</p>
                  <input type="file" multiple accept="image/*" className="absolute inset-0 cursor-pointer opacity-0" onChange={handleSourceChange} />
                </div>


                {files.source.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {files.source.map((f, i) => (
                      <div key={i} className="flex animate-scale items-center gap-1.5 sm:gap-2 rounded-md border border-stone-200 bg-white px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-bold text-stone-600 shadow-sm">
                        <span className="max-w-[80px] sm:max-w-[120px] truncate">{f.name}</span>
                        <button onClick={() => removeSource(i)} className="rounded p-0.5 hover:bg-red-100 hover:text-red-500"><X size={10} className="sm:hidden" /><X size={12} className="hidden sm:block" /></button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-xl border-2 border-stone-100 bg-white p-3 sm:p-5 shadow-sm">

                   <div className="space-y-3 sm:space-y-4">
                      {mode === 'embed' && type !== 'text' && (
                         <div className="group relative flex cursor-pointer items-center gap-3 sm:gap-4 rounded-lg border-2 border-stone-200 bg-stone-50 p-2.5 sm:p-3 transition-all hover:border-[#d97757] hover:bg-white hover:shadow-md">
                           <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-stone-500 transition group-hover:bg-[#d97757] group-hover:text-white"><Upload size={20} className="sm:hidden" /><Upload size={24} className="hidden sm:block" /></div>
                           <div className="flex-1 overflow-hidden">
                              <div className="text-[9px] sm:text-[10px] font-bold uppercase text-stone-400 group-hover:text-[#d97757]">Payload File</div>

                              <div className="truncate text-xs sm:text-sm font-bold text-stone-700">{files.wm ? files.wm.name : `Click to select ${type} file`}</div>
                           </div>
                           <input type="file" className="absolute inset-0 cursor-pointer opacity-0" onChange={handleWatermarkChange} />
                         </div>
                      )}

                      {mode === 'embed' && type === 'text' && (

                        <textarea rows="3" placeholder="Enter secret message..." className="w-full resize-none rounded-lg border-2 border-stone-200 bg-stone-50 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium text-stone-800 outline-none transition-all focus:border-[#d97757] focus:bg-white focus:shadow-md" onChange={e => setParams({...params, text: e.target.value})} />
                      )}

                      {mode === 'extract' && (
                        <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
                           {type === 'image' ? (
                             <>
                               <input type="number" placeholder="Width" value={params.width || ''} className="rounded-md border-2 border-stone-200 bg-stone-50 px-2 sm:px-2.5 py-1.5 sm:py-2 text-xs font-bold outline-none transition-all focus:border-[#d97757] focus:bg-white" onChange={e => setParams({...params, width: parseInt(e.target.value) || 0})} />
                               <input type="number" placeholder="Height" value={params.height || ''} className="rounded-md border-2 border-stone-200 bg-stone-50 px-2 sm:px-2.5 py-1.5 sm:py-2 text-xs font-bold outline-none transition-all focus:border-[#d97757] focus:bg-white" onChange={e => setParams({...params, height: parseInt(e.target.value) || 0})} />
                             </>
                           ) : (
                              <input type="number" placeholder="Expected Data Length" value={params.length || ''} className="col-span-2 rounded-md border-2 border-stone-200 bg-stone-50 px-2 sm:px-2.5 py-1.5 sm:py-2 text-xs font-bold outline-none transition-all focus:border-[#d97757] focus:bg-white" onChange={e => setParams({...params, length: parseInt(e.target.value) || 0})} />
                           )}
                        </div>
                      )}

                      
                      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2">
                        <div className="relative w-full">
                           <div className="absolute -top-2 left-3 bg-white px-1 text-[10px] font-bold text-[#d97757] flex items-center gap-1">
                              IMAGE KEY
                              <div className="group relative">
                                 <HelpCircle size={12} className="cursor-help text-stone-400 hover:text-[#d97757]" />
                                 <div className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 bottom-full mb-2 w-48 p-2 bg-stone-800 text-white text-[10px] rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 shadow-lg">
                                    Controls the random positions where watermark bits are embedded in the image. Same key = same positions.
                                    <div className="absolute left-4 sm:left-1/2 sm:-translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-stone-800"></div>
                                 </div>
                              </div>
                           </div>
                           <input type="number" placeholder="1" value={params.pwd_img} onChange={e => setParams({...params, pwd_img: e.target.value})} className="w-full rounded-lg border-2 border-stone-200 bg-white px-3 sm:px-4 py-2.5 sm:py-3 text-sm font-bold text-stone-700 outline-none transition-all focus:border-[#d97757] focus:ring-4 focus:ring-[#d97757]/10" />
                        </div>
                        <div className="relative w-full">
                           <div className="absolute -top-2 left-3 bg-white px-1 text-[10px] font-bold text-[#d97757] flex items-center gap-1">
                              WATERMARK KEY
                              <div className="group relative">
                                 <HelpCircle size={12} className="cursor-help text-stone-400 hover:text-[#d97757]" />
                                 <div className="absolute right-0 sm:left-1/2 sm:-translate-x-1/2 bottom-full mb-2 w-48 p-2 bg-stone-800 text-white text-[10px] rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 shadow-lg">
                                    Encrypts the watermark data itself. Extract requires the same key to decode correctly.
                                    <div className="absolute right-4 sm:left-1/2 sm:-translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-stone-800"></div>
                                 </div>
                              </div>
                           </div>
                           <input type="number" placeholder="1" value={params.pwd_wm} onChange={e => setParams({...params, pwd_wm: e.target.value})} className="w-full rounded-lg border-2 border-stone-200 bg-white px-3 sm:px-4 py-2.5 sm:py-3 text-sm font-bold text-stone-700 outline-none transition-all focus:border-[#d97757] focus:ring-4 focus:ring-[#d97757]/10" />
                        </div>
                      </div>
                   </div>
                </div>

                
                <button onClick={submit} disabled={loading} className="w-full rounded-xl bg-[#d97757] py-3 sm:py-4 text-base sm:text-lg font-bold text-white shadow-xl shadow-[#d97757]/20 transition-all duration-300 hover:-translate-y-1 hover:bg-[#bf6244] hover:shadow-2xl hover:shadow-[#d97757]/40 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:transform-none disabled:shadow-none">
                  {loading ? 'Processing...' : (mode === 'embed' ? 'RUN PROCESS' : 'EXTRACT DATA')}
                </button>
              </div>
            </div>
          </div>
        </div>

        
        
        <div className="lg:col-span-5">
           <div className="lg:sticky lg:top-8 h-auto min-h-[300px] sm:min-h-[400px] lg:h-[calc(100vh-8rem)] lg:min-h-[500px] rounded-2xl border-2 border-stone-200 bg-white shadow-card overflow-hidden flex flex-col">
              <div className="border-b-2 border-stone-100 bg-stone-50/50 px-3 sm:px-4 py-2 sm:py-2.5 backdrop-blur-sm flex justify-between items-center">
                 <h3 className="text-[9px] font-extrabold uppercase tracking-widest text-stone-400">Output Console</h3>
                 <div className="flex items-center gap-1.5 sm:gap-2">
                    {results.filter(r => r.image).length > 1 && (
                       <button
                          onClick={downloadAllImages}
                          className="flex items-center gap-1 rounded-full bg-[#d97757] px-2 sm:px-2.5 py-1 text-[8px] sm:text-[9px] font-bold text-white shadow-sm transition-all hover:bg-[#bf6244] hover:shadow-md active:scale-95"
                       >
                          <Download size={11} className="sm:hidden" /><Download size={12} className="hidden sm:block" /> <span className="hidden xs:inline">Download All</span><span className="xs:hidden">All</span>
                       </button>
                    )}
                    <span className="rounded-full bg-[#d97757]/10 px-1.5 py-0.5 text-[8px] font-bold text-[#d97757]">{results.length}</span>
                 </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                 {results.length === 0 && !loading && (
                    <div className="flex h-full flex-col items-center justify-center text-stone-300">
                       <Command size={40} strokeWidth={1} />
                       <p className="mt-2.5 text-[11px] font-bold">Waiting for input...</p>
                    </div>
                 )}

                 {loading && (
                    <div className="flex h-full flex-col items-center justify-center space-y-2.5">
                       <div className="h-9 w-9 animate-spin rounded-full border-4 border-stone-200 border-t-[#d97757]"></div>
                       <p className="animate-pulse text-xs font-bold text-[#d97757]">Processing...</p>
                    </div>
                 )}

                 <div className="space-y-2 sm:space-y-3">
                    {results.map((res, idx) => (
                       <div key={idx} className="animate-slide-up overflow-hidden rounded-lg border-2 border-stone-100 bg-white shadow-sm transition-all hover:shadow-md">
                          <div className="flex items-center justify-between border-b border-stone-50 bg-stone-50 px-2 sm:px-2.5 py-1 sm:py-1.5">
                             <span className="max-w-[100px] sm:max-w-[150px] truncate text-[9px] sm:text-[10px] font-bold text-stone-600">{res.filename || `Result #${idx+1}`}</span>
                             <div className="flex gap-1">
                                {res.wm_length && <span className="rounded bg-white px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-bold text-stone-600 border border-stone-200 shadow-sm">L:{res.wm_length}</span>}
                                {res.wm_width && res.wm_height && <span className="rounded bg-white px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-bold text-stone-600 border border-stone-200 shadow-sm">{res.wm_width}x{res.wm_height}</span>}
                             </div>
                          </div>

                          <div className="p-2 sm:p-2.5">
                             {res.error && (
                                <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-1.5 sm:p-2 text-[9px] sm:text-[10px] font-medium text-red-700">
                                   <div className="mt-0.5 rounded-full bg-red-200 p-0.5"><X size={9} /></div>
                                   <span className="flex-1">{res.error}</span>
                                </div>
                             )}

                             {res.image && (
                                <div className="group relative mb-2 overflow-hidden rounded-md border border-stone-100 bg-stone-100">
                                   <img src={res.image} alt="res" className="w-full object-contain" />
                                   <a href={res.image} download={generateDownloadFilename(res, idx)} className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1 bg-[#d97757]/90 py-2 sm:py-2 text-[9px] font-bold text-white opacity-100 sm:opacity-0 backdrop-blur-sm transition-opacity sm:group-hover:opacity-100 active:bg-[#bf6244]">
                                      <Download size={11} /> SAVE IMAGE
                                   </a>
                                </div>
                             )}

                             {res.content && (
                                <div className="relative mb-2 rounded-lg border-2 border-[#d97757]/30 bg-gradient-to-br from-[#d97757]/5 to-[#d97757]/10 p-3 sm:p-4">
                                   <div className="absolute -top-2.5 left-2 sm:left-3 bg-white px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-bold text-[#d97757] uppercase rounded shadow-sm">Decoded Text</div>
                                   <p className="break-all font-mono text-xs sm:text-sm font-medium text-[#bf6244] leading-relaxed mt-1">{res.content}</p>
                                </div>
                             )}

                             {res.file_b64 && (
                                <a href={`data:application/octet-stream;base64,${res.file_b64}`} download="extracted_data.bin" className="flex w-full items-center justify-center gap-1 rounded-md bg-stone-800 py-2.5 sm:py-2 text-[9px] font-bold text-white transition hover:bg-stone-900 active:bg-stone-950">
                                   <Download size={11} /> DOWNLOAD BINARY
                                </a>
                             )}

                             {res.note && (
                                <div className="mt-1.5 rounded-md bg-amber-50 border border-amber-200 p-1.5 text-[8px] sm:text-[9px] text-amber-700">
                                   {res.note}
                                </div>
                             )}
                          </div>
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        </div>

      </div>
    </div>
  );
}
