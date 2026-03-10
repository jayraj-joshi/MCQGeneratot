import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import JSZip from 'jszip';
import { 
  Upload, 
  FileJson, 
  Image as ImageIcon, 
  X, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Download,
  Code,
  ChevronRight,
  BookOpen,
  Plus,
  Trash2,
  FileText,
  Layers,
  Sun,
  Moon,
  Cpu
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { generateMCQsForDiagramBatch, DiagramResult, MCQ, Batch } from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([
    { 
      id: Math.random().toString(36).substring(7), 
      context: '', 
      contextFileName: 'context', 
      questionType: 'bdbq',
      diagrams: [], 
      status: 'idle' 
    }
  ]);

  const addBatch = () => {
    setBatches(prev => [
      ...prev, 
      { 
        id: Math.random().toString(36).substring(7), 
        context: '', 
        contextFileName: 'context', 
        questionType: 'bdbq',
        diagrams: [], 
        status: 'idle' 
      }
    ]);
  };

  const removeBatch = (id: string) => {
    setBatches(prev => prev.filter(b => b.id !== id));
  };

  const updateBatchContext = (id: string, context: string, fileName?: string) => {
    setBatches(prev => prev.map(b => b.id === id ? { 
      ...b, 
      context, 
      contextFileName: fileName ? fileName.replace(/\.[^/.]+$/, "") : b.contextFileName 
    } : b));
  };

  const updateBatchQuestionType = (id: string, questionType: 'bdbq' | 'cdbq') => {
    setBatches(prev => prev.map(b => b.id === id ? { ...b, questionType } : b));
  };

  const addDiagramsToBatch = (batchId: string, files: File[]) => {
    const newDiagrams = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      fileName: file.name,
      preview: URL.createObjectURL(file),
      file: file,
      questions: [],
      status: 'idle' as const,
    }));
    setBatches(prev => prev.map(b => b.id === batchId ? { ...b, diagrams: [...b.diagrams, ...newDiagrams] } : b));
  };

  const removeDiagramFromBatch = (batchId: string, diagramId: string) => {
    setBatches(prev => prev.map(b => b.id === batchId ? { 
      ...b, 
      diagrams: b.diagrams.filter(d => d.id !== diagramId) 
    } : b));
  };

  const generateBatch = async (batchId: string) => {
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return;

    if (!batch.context.trim()) {
      alert("Please provide NCERT context for this batch.");
      return;
    }
    if (batch.diagrams.length === 0) {
      alert("Please upload at least one diagram for this batch.");
      return;
    }

    setBatches(prev => prev.map(b => b.id === batchId ? { ...b, status: 'loading' } : b));

    const diagramsToProcess = batch.diagrams.filter(d => d.status !== 'success');
    
    // Process in chunks of 6
    const chunkSize = 6;
    for (let i = 0; i < diagramsToProcess.length; i += chunkSize) {
      const chunk = diagramsToProcess.slice(i, i + chunkSize);
      
      // Set chunk diagrams to loading
      setBatches(prev => prev.map(b => b.id === batchId ? {
        ...b,
        diagrams: b.diagrams.map(d => chunk.some(cd => cd.id === d.id) ? { ...d, status: 'loading' } : d)
      } : b));

      try {
        const diagramData = await Promise.all(chunk.map(async (diagram) => {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(diagram.file);
          });
          return { id: diagram.id, base64, fileName: diagram.fileName };
        }));

        const { results, usage } = await generateMCQsForDiagramBatch(diagramData, batch.context, batch.questionType);
        
        setBatches(prev => prev.map(b => b.id === batchId ? {
          ...b,
          totalTokens: (b.totalTokens || 0) + usage.totalTokens,
          diagrams: b.diagrams.map(d => {
            if (results[d.id]) {
              return { 
                ...d, 
                questions: results[d.id], 
                status: 'success',
                tokens: {
                  prompt: Math.round(usage.promptTokens / chunk.length),
                  candidates: Math.round(usage.candidatesTokens / chunk.length),
                  total: Math.round(usage.totalTokens / chunk.length)
                }
              };
            }
            return d;
          })
        } : b));
      } catch (error: any) {
        setBatches(prev => prev.map(b => b.id === batchId ? {
          ...b,
          diagrams: b.diagrams.map(d => chunk.some(cd => cd.id === d.id) ? { ...d, status: 'error', error: error.message } : d)
        } : b));
      }
    }

    setBatches(prev => prev.map(b => b.id === batchId ? { ...b, status: 'success' } : b));
  };

  const addDiagramToZip = (zip: JSZip, batch: Batch, diagram: DiagramResult) => {
    if (diagram.status !== 'success' || diagram.questions.length === 0) return;

    const baseName = diagram.fileName.replace(/\.[^/.]+$/, "");
    const folderName = `${batch.contextFileName}_${baseName}`;
    const folder = zip.folder(folderName);

    if (folder) {
      // Add JSON
      const jsonFileName = `${batch.contextFileName}_${baseName}.json`;
      folder.file(jsonFileName, JSON.stringify(diagram.questions, null, 2));

      // Add Image
      try {
        folder.file(diagram.fileName, diagram.file);
      } catch (err) {
        console.error(`Failed to add image ${diagram.fileName} to zip`, err);
      }
    }
  };

  const triggerDownload = async (zip: JSZip, filename: string) => {
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const downloadZipFromBatch = async (batch: Batch) => {
    const zip = new JSZip();
    batch.diagrams.forEach(diagram => addDiagramToZip(zip, batch, diagram));
    await triggerDownload(zip, `batch_${batch.id}_mcqs.zip`);
  };

  const downloadAllBatchesZip = async () => {
    const zip = new JSZip();
    const successfulBatches = batches.filter(b => b.diagrams.some(d => d.status === 'success'));
    
    if (successfulBatches.length === 0) return;

    successfulBatches.forEach(batch => {
      const batchFolderName = `batch_${batch.id}_${batch.contextFileName}`;
      const batchFolder = zip.folder(batchFolderName);
      if (batchFolder) {
        batch.diagrams.forEach(diagram => addDiagramToZip(batchFolder, batch, diagram));
      }
    });

    await triggerDownload(zip, `all_batches_mcqs.zip`);
  };

  return (
    <div className={cn("min-h-screen flex flex-col transition-colors duration-300", darkMode ? "bg-stone-950 text-stone-100 dark" : "bg-stone-50 text-stone-900")}>
      <header className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 px-6 py-4 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <BookOpen className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-stone-900 dark:text-white tracking-tight">NCERT MCQ Generator</h1>
              <p className="text-xs text-stone-500 dark:text-stone-400 font-medium uppercase tracking-wider">Multi-Batch AI Engine</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
              title="Toggle Dark Mode"
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            {batches.some(b => b.diagrams.some(d => d.status === 'success')) && (
              <button
                onClick={downloadAllBatchesZip}
                className="px-6 py-2.5 rounded-full font-semibold text-sm bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-white shadow-lg shadow-stone-900/10 active:scale-95 transition-all flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download All
              </button>
            )}
            <button
              onClick={addBatch}
              className="px-6 py-2.5 rounded-full font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 active:scale-95 transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Batch
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-12">
        <AnimatePresence mode="popLayout">
          {batches.map((batch, index) => (
            <motion.section
              key={batch.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xl overflow-hidden"
            >
              <div className="bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-800 px-8 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">
                    {index + 1}
                  </span>
                  <div className="flex flex-col">
                    <h2 className="font-bold text-stone-800 dark:text-stone-100">Batch {batch.id}</h2>
                    {batch.totalTokens && (
                      <div className="flex items-center gap-1 text-[10px] text-stone-500 dark:text-stone-400 font-mono">
                        <Cpu className="w-3 h-3" />
                        {batch.totalTokens.toLocaleString()} tokens used
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {batch.status === 'success' && (
                    <button
                      onClick={() => downloadZipFromBatch(batch)}
                      className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1"
                    >
                      <Download className="w-4 h-4" />
                      Download ZIP
                    </button>
                  )}
                  <button
                    onClick={() => removeBatch(batch.id)}
                    className="p-2 text-stone-400 dark:text-stone-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* Batch Inputs */}
                <div className="space-y-8">
                  <div className="flex flex-col gap-6">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <FileJson className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                          <h3 className="font-bold text-stone-800 dark:text-stone-100">NCERT Context</h3>
                        </div>
                        <JsonFileUpload onUpload={(text, name) => updateBatchContext(batch.id, text, name)} darkMode={darkMode} />
                      </div>
                      <textarea
                        value={batch.context}
                        onChange={(e) => updateBatchContext(batch.id, e.target.value)}
                        placeholder='Paste NCERT context or upload a JSON file...'
                        className="w-full h-48 p-4 bg-stone-50 dark:bg-stone-800/30 border border-stone-200 dark:border-stone-800 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all resize-none dark:text-stone-300"
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <Layers className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        <h3 className="font-bold text-stone-800 dark:text-stone-100">Question Type</h3>
                      </div>
                      <div className="flex gap-4">
                        {['bdbq', 'cdbq'].map((type) => (
                          <button
                            key={type}
                            onClick={() => updateBatchQuestionType(batch.id, type as 'bdbq' | 'cdbq')}
                            className={cn(
                              "flex-1 py-3 rounded-xl border font-bold text-sm transition-all",
                              batch.questionType === type 
                                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500 text-emerald-700 dark:text-emerald-400" 
                                : "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 hover:border-emerald-300"
                            )}
                          >
                            {type.toUpperCase()}
                            <p className="text-[10px] font-medium opacity-60">
                              {type === 'bdbq' ? 'Exams: [NEET]' : 'Exams: [NEET, JEE]'}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <ImageIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      <h3 className="font-bold text-stone-800 dark:text-stone-100">Diagrams</h3>
                    </div>
                    <DiagramDropzone onDrop={(files) => addDiagramsToBatch(batch.id, files)} darkMode={darkMode} />
                    
                    <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {batch.diagrams.map((diagram) => (
                        <div key={diagram.id} className="relative group aspect-square rounded-xl overflow-hidden border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800">
                          <img src={diagram.preview} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button 
                              onClick={() => removeDiagramFromBatch(batch.id, diagram.id)}
                              className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          {diagram.status === 'success' && (
                            <div className="absolute top-2 right-2 bg-emerald-500 text-white p-1 rounded-full shadow-lg">
                              <CheckCircle2 className="w-3 h-3" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => generateBatch(batch.id)}
                    disabled={batch.status === 'loading' || (batch.diagrams.length === 0 && !batch.context)}
                    className={cn(
                      "w-full py-4 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3",
                      batch.status === 'loading'
                        ? "bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-600 cursor-not-allowed"
                        : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-xl shadow-emerald-600/20 active:scale-[0.98]"
                    )}
                  >
                    {batch.status === 'loading' ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Generating Batch...
                      </>
                    ) : (
                      <>
                        Generate Questions
                        <ChevronRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>

                {/* Batch Results */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 mb-4">
                    <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <h3 className="font-bold text-stone-800 dark:text-stone-100">Results</h3>
                  </div>
                  
                  {batch.diagrams.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center text-stone-400 dark:text-stone-600 border-2 border-dashed border-stone-200 dark:border-stone-800 rounded-3xl">
                      <ImageIcon className="w-12 h-12 mb-2 opacity-20" />
                      <p className="text-sm font-medium">Upload diagrams to see results</p>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                      {batch.diagrams.map((diagram) => (
                        <DiagramResultCard 
                          key={diagram.id} 
                          diagram={diagram} 
                          darkMode={darkMode}
                          onDownload={async () => {
                            const zip = new JSZip();
                            addDiagramToZip(zip, batch, diagram);
                            await triggerDownload(zip, `${batch.contextFileName}_${diagram.fileName.split('.')[0]}.zip`);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.section>
          ))}
        </AnimatePresence>

        {batches.length === 0 && (
          <div className="text-center py-20">
            <BookOpen className="w-16 h-16 text-stone-200 dark:text-stone-800 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-stone-400 dark:text-stone-600">No batches created</h2>
            <button onClick={addBatch} className="mt-4 text-emerald-600 dark:text-emerald-400 font-bold hover:underline">
              Create your first batch
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function JsonFileUpload({ onUpload, darkMode }: { onUpload: (text: string, name: string) => void, darkMode: boolean }) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        onUpload(text, file.name);
      };
      reader.readAsText(file);
    }
  }, [onUpload]);

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: { 'application/json': ['.json'] },
    multiple: false
  } as any);

  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />
      <button className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-full transition-colors">
        <Upload className="w-3 h-3" />
        Upload JSON
      </button>
    </div>
  );
}

function DiagramDropzone({ onDrop, darkMode }: { onDrop: (files: File[]) => void, darkMode: boolean }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true
  } as any);

  return (
    <div 
      {...getRootProps()} 
      className={cn(
        "border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer",
        isDragActive 
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10" 
          : "border-stone-200 dark:border-stone-800 hover:border-emerald-400 dark:hover:border-emerald-500 hover:bg-stone-50 dark:hover:bg-stone-800/50"
      )}
    >
      <input {...getInputProps()} />
      <Upload className="w-8 h-8 text-stone-400 dark:text-stone-600 mx-auto mb-3" />
      <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
        {isDragActive ? "Drop images here" : "Click or drag diagrams"}
      </p>
    </div>
  );
}

function DiagramResultCard({ diagram, onDownload, darkMode }: { diagram: DiagramResult, onDownload: () => void, darkMode: boolean, key?: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showJson, setShowJson] = useState(false);

  return (
    <div className="bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 overflow-hidden shadow-sm">
      <div className="p-4 flex items-center gap-4">
        <img src={diagram.preview} className="w-16 h-16 rounded-lg object-cover border border-stone-100 dark:border-stone-700" />
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-stone-800 dark:text-stone-100 text-sm truncate">{diagram.fileName}</h4>
          <div className="flex items-center gap-3 mt-1">
            <StatusBadge status={diagram.status} />
            {diagram.status === 'success' && (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => {
                    setIsExpanded(!isExpanded);
                    setShowJson(false);
                  }}
                  className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider hover:underline"
                >
                  {isExpanded ? 'Hide' : 'View Questions'}
                </button>
                <span className="text-stone-300 dark:text-stone-600">|</span>
                <button 
                  onClick={() => {
                    setShowJson(!showJson);
                    setIsExpanded(false);
                  }}
                  className="text-[10px] font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider hover:underline flex items-center gap-1"
                >
                  <Code className="w-2.5 h-2.5" />
                  {showJson ? 'Hide JSON' : 'View JSON'}
                </button>
              </div>
            )}
          </div>
          {diagram.tokens && (
            <div className="flex items-center gap-2 mt-1 text-[9px] text-stone-400 dark:text-stone-500 font-mono">
              <span>P: {diagram.tokens.prompt}</span>
              <span>C: {diagram.tokens.candidates}</span>
              <span className="font-bold text-stone-500 dark:text-stone-400">T: {diagram.tokens.total}</span>
            </div>
          )}
        </div>
        {diagram.status === 'success' && (
          <button onClick={onDownload} className="p-2 text-stone-400 dark:text-stone-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
            <Download className="w-4 h-4" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {showJson && diagram.status === 'success' && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="border-t border-stone-100 dark:border-stone-700 bg-stone-900"
          >
            <div className="p-4">
              <pre className="text-[10px] font-mono text-emerald-400 overflow-x-auto custom-scrollbar whitespace-pre-wrap">
                {JSON.stringify(diagram.questions, null, 2)}
              </pre>
            </div>
          </motion.div>
        )}

        {isExpanded && diagram.questions.length > 0 && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="border-t border-stone-50 dark:border-stone-700 bg-stone-50/30 dark:bg-stone-900/30"
          >
            <div className="p-4 space-y-4">
              {diagram.questions.map((q, idx) => (
                <div key={idx} className="text-xs space-y-2">
                  <p className="font-bold text-stone-800 dark:text-stone-200">{idx + 1}. {q.question}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className={cn(
                        "p-2 rounded border text-[10px]",
                        opt === q.answer 
                          ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 font-bold" 
                          : "bg-white dark:bg-stone-800 border-stone-100 dark:border-stone-700 text-stone-500 dark:text-stone-400"
                      )}>
                        {opt}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ status }: { status: DiagramResult['status'] }) {
  switch (status) {
    case 'idle':
      return <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Ready</span>;
    case 'loading':
      return <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest animate-pulse">Processing</span>;
    case 'success':
      return <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Success</span>;
    case 'error':
      return <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Error</span>;
    default:
      return null;
  }
}
