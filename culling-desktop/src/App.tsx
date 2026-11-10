import { useState, useEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  FolderOpen,
  Star,
  Eye,
  EyeOff,
  Crosshair,
  Sparkles,
  CheckCircle,
  ExternalLink,
  Camera,
  Zap,
  LayoutGrid,
  Columns2,
  GitCompare,
  Maximize2,
  XCircle,
  Layers,
  ArrowUpDown,
  Download,
  ThumbsUp,
  Sliders,
  Check
} from 'lucide-react';
import './App.css';

interface PhotoItem {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  modifiedTime: number;
  isRaw: boolean;
  rating: number;
  colorLabel: string | null;
  blurScore: number;
  eyesOpen: boolean;
  isRecommended: boolean;
  groupId: number;
  isKissingOrClose?: boolean;
  smileScore?: number;
  exposurePenalty?: number;
}

declare global {
  interface Window {
    cullingAPI?: {
      openDirectory: () => Promise<string | null>;
      scanDirectory: (dir: string) => Promise<PhotoItem[]>;
      saveXmp: (data: { filePath: string; rating: number; colorLabel: string | null }) => Promise<{ success: boolean }>;
      revealInFolder: (path: string) => Promise<boolean>;
      exportSelected: (data: { sourceDir: string; photoPaths: string[] }) => Promise<{ success: boolean; count: number; destDir: string; error?: string }>;
      runAIAnalysis: (dir: string) => Promise<{ success: boolean; results?: PhotoItem[]; error?: string }>;
      onAIProgress: (callback: (p: { current: number; total: number; percent: number }) => void) => () => void;
    };
  }
}

function getImageUrl(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/');
  return `culling-thumb://local/${normalized}`;
}

export default function App() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [filter, setFilter] = useState<'all' | 'picks' | 'eyes' | 'focus' | 'rated' | 'rejected'>('all');
  const [sortBy, setSortBy] = useState<'time' | 'focus' | 'name' | 'rating'>('time');
  const [viewMode, setViewMode] = useState<'split' | 'grid' | 'compare' | 'loupe'>('split');
  const [columns, setColumns] = useState<number>(4);
  const [currentFolder, setCurrentFolder] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [zoomMode, setZoomMode] = useState<boolean>(false);
  const [isAnalyzingAI, setIsAnalyzingAI] = useState<boolean>(false);
  const [aiProgress, setAiProgress] = useState<{ current: number; total: number; percent: number } | null>(null);
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [toast, setToast] = useState<string | null>(null);
  const [showBatchMenu, setShowBatchMenu] = useState<boolean>(false);

  const gridContainerRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);

  // Exibe notificação temporária
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Timer da animação de entrada (Splash Screen)
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 2200);
    return () => clearTimeout(timer);
  }, []);

  // Escuta progresso do worker de IA
  useEffect(() => {
    if (window.cullingAPI?.onAIProgress) {
      const unsubscribe = window.cullingAPI.onAIProgress((p) => {
        setAiProgress(p);
      });
      return () => unsubscribe();
    }
  }, []);

  // Executa o Motor de IA Real
  const handleRunAI = async () => {
    if (!currentFolder || !window.cullingAPI?.runAIAnalysis) return;

    setIsAnalyzingAI(true);
    setAiProgress({ current: 0, total: photos.length, percent: 0 });

    try {
      const res = await window.cullingAPI.runAIAnalysis(currentFolder);
      if (res.success && res.results) {
        setPhotos(res.results);
        setFilter('picks');
        showToast(`Análise concluída! ${res.results.filter((r) => r.isRecommended).length} fotos eleitas como Top Pick.`);
      } else {
        alert('Erro ao executar IA: ' + (res.error || 'Erro desconhecido'));
      }
    } catch (err) {
      console.error('Falha no worker de IA:', err);
    } finally {
      setIsAnalyzingAI(false);
      setAiProgress(null);
    }
  };

  // Manipulador de abertura de pasta
  const handleOpenFolder = async () => {
    if (!window.cullingAPI) {
      alert('Ambiente Electron não detectado.');
      return;
    }

    setIsLoading(true);
    try {
      const folderPath = await window.cullingAPI.openDirectory();
      if (folderPath) {
        setCurrentFolder(folderPath);
        const scanned = await window.cullingAPI.scanDirectory(folderPath);

        const groups: { [key: number]: PhotoItem[] } = {};
        scanned.forEach((p) => {
          if (!groups[p.groupId]) groups[p.groupId] = [];
          groups[p.groupId].push(p);
        });

        Object.values(groups).forEach((grp) => {
          if (grp.length > 0) {
            grp.sort((a, b) => (b.eyesOpen ? 1 : 0) * 100 + b.blurScore - ((a.eyesOpen ? 1 : 0) * 100 + a.blurScore));
            grp[0].isRecommended = true;
          }
        });

        setPhotos(scanned);
        setSelectedIndex(0);
        showToast(`${scanned.length} fotos carregadas com sucesso!`);
      }
    } catch (err) {
      console.error('Falha ao escanear pasta:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Ações em Lote (Batch Actions)
  const handleApproveAllPicks = async () => {
    setShowBatchMenu(false);
    let count = 0;
    const updated = photos.map((p) => {
      if (p.isRecommended) {
        count++;
        if (window.cullingAPI) {
          window.cullingAPI.saveXmp({ filePath: p.path, rating: 5, colorLabel: 'green' });
        }
        return { ...p, rating: 5, colorLabel: 'green' };
      }
      return p;
    });
    setPhotos(updated);
    showToast(`${count} fotos Top Pick aprovadas com 5 estrelas e verde!`);
  };

  const handleRejectAllBlinks = async () => {
    setShowBatchMenu(false);
    let count = 0;
    const updated = photos.map((p) => {
      if (!p.eyesOpen && !p.isKissingOrClose) {
        count++;
        if (window.cullingAPI) {
          window.cullingAPI.saveXmp({ filePath: p.path, rating: 1, colorLabel: 'red' });
        }
        return { ...p, rating: 1, colorLabel: 'red' };
      }
      return p;
    });
    setPhotos(updated);
    showToast(`${count} fotos com piscadas marcadas como rejeitadas.`);
  };

  const handleExportApproved = async () => {
    setShowBatchMenu(false);
    if (!currentFolder || !window.cullingAPI?.exportSelected) return;

    const approved = photos.filter((p) => p.rating >= 4 || p.colorLabel === 'green' || p.isRecommended);
    if (approved.length === 0) {
      showToast('Nenhuma foto aprovada para exportar.');
      return;
    }

    showToast(`Exportando ${approved.length} fotos selecionadas...`);
    const res = await window.cullingAPI.exportSelected({
      sourceDir: currentFolder,
      photoPaths: approved.map((p) => p.path)
    });

    if (res.success) {
      showToast(`Exportação concluída! ${res.count} fotos salvas em _SELECIONADAS_SELECT_EA.`);
    } else {
      showToast('Erro ao exportar: ' + res.error);
    }
  };

  // Contadores para os filtros
  const counts = useMemo(() => {
    return {
      all: photos.length,
      picks: photos.filter((p) => p.isRecommended || p.rating >= 4).length,
      eyes: photos.filter((p) => p.eyesOpen).length,
      focus: photos.filter((p) => p.blurScore >= 85).length,
      rated: photos.filter((p) => p.rating > 0).length,
      rejected: photos.filter((p) => p.rating === 1 || p.colorLabel === 'red').length,
      bursts: new Set(photos.map((p) => p.groupId)).size
    };
  }, [photos]);

  // Filtragem e Ordenação
  const processedPhotos = useMemo(() => {
    let result = photos.filter((p) => {
      if (filter === 'picks') return p.isRecommended || p.rating >= 4;
      if (filter === 'eyes') return p.eyesOpen;
      if (filter === 'focus') return p.blurScore >= 85;
      if (filter === 'rated') return p.rating > 0;
      if (filter === 'rejected') return p.rating === 1 || p.colorLabel === 'red';
      return true;
    });

    if (sortBy === 'focus') {
      result.sort((a, b) => b.blurScore - a.blurScore);
    } else if (sortBy === 'rating') {
      result.sort((a, b) => b.rating - a.rating);
    } else if (sortBy === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => a.modifiedTime - b.modifiedTime);
    }

    return result;
  }, [photos, filter, sortBy]);

  const selectedPhoto = processedPhotos[selectedIndex] || null;

  // Encontra o Top Pick da mesma rajada da foto selecionada (para modo comparador)
  const currentBurstWinner = useMemo(() => {
    if (!selectedPhoto) return null;
    const sameGroup = photos.filter((p) => p.groupId === selectedPhoto.groupId);
    return sameGroup.find((p) => p.isRecommended) || sameGroup[0] || null;
  }, [photos, selectedPhoto]);

  // Atualizar Rating e gravar XMP
  const updateRating = async (newRating: number) => {
    if (!selectedPhoto) return;

    const updated = { ...selectedPhoto, rating: newRating };
    setPhotos((prev) => prev.map((p) => (p.path === selectedPhoto.path ? updated : p)));
    showToast(`Nota ${newRating} estrelas atribuída`);

    if (window.cullingAPI) {
      await window.cullingAPI.saveXmp({
        filePath: selectedPhoto.path,
        rating: newRating,
        colorLabel: selectedPhoto.colorLabel
      });
    }
  };

  // Atualizar Cor e gravar XMP
  const updateColorLabel = async (color: string | null) => {
    if (!selectedPhoto) return;

    const newColor = selectedPhoto.colorLabel === color ? null : color;
    const updated = { ...selectedPhoto, colorLabel: newColor };
    setPhotos((prev) => prev.map((p) => (p.path === selectedPhoto.path ? updated : p)));
    showToast(newColor ? `Cor ${newColor.toUpperCase()} atribuída` : 'Cor removida');

    if (window.cullingAPI) {
      await window.cullingAPI.saveXmp({
        filePath: selectedPhoto.path,
        rating: selectedPhoto.rating,
        colorLabel: newColor
      });
    }
  };

  // Atalhos de teclado profissionais
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, processedPhotos.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key >= '0' && e.key <= '5') {
        e.preventDefault();
        updateRating(parseInt(e.key, 10));
      } else if (e.key === '6') {
        updateColorLabel('red');
      } else if (e.key === '7') {
        updateColorLabel('yellow');
      } else if (e.key === '8') {
        updateColorLabel('green');
      } else if (e.key === '9') {
        updateColorLabel('blue');
      } else if (e.key.toLowerCase() === 'p') {
        updateRating(5);
        updateColorLabel('green');
      } else if (e.key.toLowerCase() === 'x') {
        updateRating(1);
        updateColorLabel('red');
      } else if (e.key.toLowerCase() === 'u') {
        updateRating(0);
        updateColorLabel(null);
      } else if (e.key.toLowerCase() === 'g') {
        setViewMode('grid');
      } else if (e.key.toLowerCase() === 's') {
        setViewMode('split');
      } else if (e.key.toLowerCase() === 'c') {
        setViewMode('compare');
      } else if (e.key.toLowerCase() === 'l') {
        setViewMode('loupe');
      } else if (e.key === ' ') {
        e.preventDefault();
        setZoomMode((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [processedPhotos, selectedPhoto]);

  // Virtualização da Grade
  const rowCount = Math.ceil(processedPhotos.length / columns);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridContainerRef.current,
    estimateSize: () => Math.round(750 / columns),
    overscan: 3
  });

  return (
    <div className="app-container">
      {/* Toast de Notificação */}
      {toast && (
        <div className="toast-notification">
          <Check size={14} color="var(--accent-green)" />
          <span>{toast}</span>
        </div>
      )}

      {/* Animação de Entrada (Splash Screen) */}
      <div
        className={`splash-overlay ${!showSplash ? 'fade-out' : ''}`}
        onClick={() => setShowSplash(false)}
        title="Clique para avançar"
      >
        <div className="splash-content">
          <div className="splash-logo-wrapper">
            <img src="/logo.png" alt="Select EA" className="splash-logo-img" />
            <div className="splash-rec-pulse" />
          </div>
          <h1 className="splash-title">
            SELECT <span className="ea-accent">EA</span>
          </h1>
          <p className="splash-subtitle">INTELLIGENT PHOTO CULLING STUDIO</p>
          <div className="splash-loader-bar">
            <div className="splash-loader-progress" />
          </div>
        </div>
      </div>

      {/* Header Superior Principal */}
      <header className="app-header">
        <div className="brand-section">
          <img src="/logo.png" alt="Select EA" className="brand-logo-icon" />
          <span className="brand-title">
            SELECT <span style={{ color: 'var(--accent-red)' }}>EA</span>
            <span className="brand-rec-dot" />
          </span>
          {currentFolder && (
            <span className="folder-tag">
              📁 {currentFolder.split('\\').pop() || currentFolder}
            </span>
          )}
        </div>

        {/* Barra Central com Modos de Visão e Filtros */}
        <div className="center-toolbar">
          {/* Seletor de Modo de Visualização */}
          <div className="view-modes-group">
            <button
              className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Modo Grade Completa (G)"
            >
              <LayoutGrid size={13} />
              Grade
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
              title="Modo Painel Dividido (S)"
            >
              <Columns2 size={13} />
              Painel
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'compare' ? 'active' : ''}`}
              onClick={() => setViewMode('compare')}
              title="Comparar Lado a Lado com o Top Pick (C)"
            >
              <GitCompare size={13} />
              Comparar
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'loupe' ? 'active' : ''}`}
              onClick={() => setViewMode('loupe')}
              title="Visualizador Tela Cheia (L)"
            >
              <Maximize2 size={13} />
              Loupe
            </button>
          </div>

          {/* Slider de Tamanho das Miniaturas */}
          <div className="zoom-slider-box" title="Ajustar tamanho da grade">
            <span>{columns} col</span>
            <input
              type="range"
              min={2}
              max={6}
              value={columns}
              onChange={(e) => setColumns(parseInt(e.target.value, 10))}
            />
          </div>

          {/* Ordenação */}
          <div className="sort-box" title="Ordenar fotos">
            <ArrowUpDown size={12} />
            <select
              className="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="time">Hora de Captura</option>
              <option value="focus">Maior Foco / Nitidez</option>
              <option value="rating">Classificação (★)</option>
              <option value="name">Nome do Arquivo</option>
            </select>
          </div>

          {/* Filtros de Fotos com Contadores */}
          <div className="filters-bar">
            <button
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              Todas <span className="filter-count">{counts.all}</span>
            </button>
            <button
              className={`filter-btn ${filter === 'picks' ? 'active' : ''}`}
              onClick={() => setFilter('picks')}
            >
              <Sparkles size={12} color="var(--accent-green)" />
              Top Picks <span className="filter-count">{counts.picks}</span>
            </button>
            <button
              className={`filter-btn ${filter === 'eyes' ? 'active' : ''}`}
              onClick={() => setFilter('eyes')}
            >
              <Eye size={12} color="var(--accent-blue)" />
              Olhos <span className="filter-count">{counts.eyes}</span>
            </button>
            <button
              className={`filter-btn ${filter === 'focus' ? 'active' : ''}`}
              onClick={() => setFilter('focus')}
            >
              <Crosshair size={12} color="var(--accent-amber)" />
              Foco <span className="filter-count">{counts.focus}</span>
            </button>
            <button
              className={`filter-btn ${filter === 'rated' ? 'active' : ''}`}
              onClick={() => setFilter('rated')}
            >
              <Star size={12} color="var(--accent-amber)" fill="currentColor" />
              Classificadas <span className="filter-count">{counts.rated}</span>
            </button>
            <button
              className={`filter-btn ${filter === 'rejected' ? 'active' : ''}`}
              onClick={() => setFilter('rejected')}
            >
              <XCircle size={12} color="var(--accent-red)" />
              Rejeitadas <span className="filter-count">{counts.rejected}</span>
            </button>
          </div>
        </div>

        {/* Botões de Ação na Direita */}
        <div className="actions-section">
          {photos.length > 0 && (
            <button
              className="btn-ai-analyze"
              onClick={handleRunAI}
              disabled={isAnalyzingAI || isLoading}
            >
              <Zap size={14} fill="currentColor" />
              {isAnalyzingAI
                ? `Analisando (${aiProgress?.current}/${aiProgress?.total})`
                : '⚡ Rodar Seleção por IA'}
            </button>
          )}

          {/* Dropdown Ações em Lote */}
          {photos.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                className="btn-batch-actions"
                onClick={() => setShowBatchMenu((p) => !p)}
              >
                <Sliders size={13} />
                Ações
              </button>
              {showBatchMenu && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 6,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    padding: 6,
                    minWidth: 230,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    zIndex: 50
                  }}
                >
                  <button
                    onClick={handleApproveAllPicks}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      padding: '8px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <ThumbsUp size={13} color="var(--accent-green)" />
                    Aprovar Todos os Picks (5★)
                  </button>
                  <button
                    onClick={handleRejectAllBlinks}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      padding: '8px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <XCircle size={13} color="var(--accent-red)" />
                    Rejeitar Todas as Piscadas
                  </button>
                  <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
                  <button
                    onClick={handleExportApproved}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--accent-green)',
                      padding: '8px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Download size={13} />
                    Exportar Aprovadas para Pasta
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            className="btn-open-folder"
            onClick={handleOpenFolder}
            disabled={isLoading || isAnalyzingAI}
          >
            <FolderOpen size={14} />
            {isLoading ? 'Escaneando...' : 'Abrir Pasta'}
          </button>
        </div>
      </header>

      {/* Faixa de Progresso Luminosa da IA */}
      {isAnalyzingAI && aiProgress && (
        <div className="ai-progress-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={14} className="animate-pulse" />
            <span>
              Inteligência Artificial analisando fotos: {aiProgress.current} de {aiProgress.total} ({aiProgress.percent}%)
            </span>
          </div>
          <div
            className="progress-track"
            style={{ width: `${aiProgress.percent}%` }}
          />
        </div>
      )}

      {/* Espaço de Trabalho */}
      <div className="workspace">
        {/* Grade Virtualizada (Modos 'grid' e 'split') */}
        {viewMode !== 'loupe' && viewMode !== 'compare' && (
          <div className="grid-container" ref={gridContainerRef}>
            {processedPhotos.length === 0 ? (
              <div
                style={{
                  height: '70vh',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  gap: 12
                }}
              >
                <Camera size={44} strokeWidth={1.5} />
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Nenhuma foto correspondente ao filtro ativo
                </p>
                <p style={{ fontSize: 12 }}>
                  Selecione outro filtro acima ou clique em <strong>"Abrir Pasta"</strong> para carregar o ensaio.
                </p>
              </div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative'
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const startIndex = virtualRow.index * columns;
                  const rowItems = processedPhotos.slice(startIndex, startIndex + columns);

                  return (
                    <div
                      key={virtualRow.key}
                      className="virtual-grid-row"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {rowItems.map((photo, colIdx) => {
                        const itemIndex = startIndex + colIdx;
                        const isSelected = itemIndex === selectedIndex;

                        return (
                          <div
                            key={photo.path}
                            className={`photo-card ${isSelected ? 'selected' : ''}`}
                            onClick={() => setSelectedIndex(itemIndex)}
                          >
                            <img
                              src={getImageUrl(photo.path)}
                              alt={photo.name}
                              loading="lazy"
                            />

                            {/* Badges Superiores */}
                            <div className="card-top-badges">
                              {photo.isRecommended ? (
                                <span className="badge-pick">
                                  <Sparkles size={9} fill="currentColor" /> TOP PICK
                                </span>
                              ) : (
                                <span className="badge-burst-id">R#{photo.groupId}</span>
                              )}

                              <div className="badge-ai-group">
                                <span className={`badge-pill ${photo.eyesOpen ? 'good' : 'bad'}`}>
                                  {photo.eyesOpen ? <Eye size={10} /> : <EyeOff size={10} />}
                                </span>
                                <span
                                  className={`badge-pill ${
                                    photo.blurScore >= 85 ? 'good' : photo.blurScore >= 65 ? 'warn' : 'bad'
                                  }`}
                                >
                                  <Crosshair size={10} />
                                  {Math.round(photo.blurScore)}%
                                </span>
                              </div>
                            </div>

                            {/* Informações Inferiores */}
                            <div className="card-bottom-info">
                              <span className="photo-filename">{photo.name}</span>
                              <div className="card-stars">
                                {photo.rating > 0 &&
                                  Array.from({ length: photo.rating }).map((_, i) => (
                                    <Star key={i} size={10} fill="currentColor" />
                                  ))}
                                {photo.colorLabel && (
                                  <span
                                    className="color-dot"
                                    style={{
                                      backgroundColor:
                                        photo.colorLabel === 'red'
                                          ? 'var(--accent-red)'
                                          : photo.colorLabel === 'green'
                                          ? 'var(--accent-green)'
                                          : photo.colorLabel === 'yellow'
                                          ? 'var(--accent-amber)'
                                          : 'var(--accent-blue)',
                                      marginLeft: 4
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Modo Comparador Lado a Lado ('compare') */}
        {viewMode === 'compare' && selectedPhoto && currentBurstWinner && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="compare-container">
              {/* Foto Atual Selecionada */}
              <div className="compare-half">
                <div className="compare-half-header">
                  <span>Foto Atual: {selectedPhoto.name}</span>
                  <span style={{ color: selectedPhoto.eyesOpen ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {selectedPhoto.eyesOpen ? 'Olhos Abertos' : 'Piscando'} • Foco {Math.round(selectedPhoto.blurScore)}%
                  </span>
                </div>
                <div className="compare-half-view">
                  <img src={getImageUrl(selectedPhoto.path)} alt="Foto Atual" />
                </div>
              </div>

              {/* Top Pick da Mesma Rajada */}
              <div className="compare-half" style={{ borderLeft: '1px solid var(--border-subtle)' }}>
                <div className="compare-half-header" style={{ borderColor: 'var(--accent-green)' }}>
                  <Sparkles size={12} color="var(--accent-green)" />
                  <span style={{ color: 'var(--accent-green)' }}>Top Pick da Rajada: {currentBurstWinner.name}</span>
                  <span>Foco {Math.round(currentBurstWinner.blurScore)}%</span>
                </div>
                <div className="compare-half-view">
                  <img src={getImageUrl(currentBurstWinner.path)} alt="Top Pick" />
                </div>
              </div>
            </div>

            {/* Filmstrip Inferior de Navegação */}
            <div className="bottom-filmstrip" ref={filmstripRef}>
              {processedPhotos.map((p, idx) => (
                <div
                  key={p.path}
                  className={`filmstrip-thumb ${idx === selectedIndex ? 'selected' : ''}`}
                  onClick={() => setSelectedIndex(idx)}
                >
                  <img src={getImageUrl(p.path)} alt={p.name} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Painel de Inspeção & Loupe (Modo 'split' ou 'loupe') */}
        {(viewMode === 'split' || viewMode === 'loupe') && selectedPhoto && (
          <div style={{ flex: viewMode === 'loupe' ? 1 : undefined, display: 'flex', flexDirection: 'column' }}>
            <aside className="detail-panel" style={{ width: viewMode === 'loupe' ? '100%' : '480px', flex: 1 }}>
              {/* Visualizador Principal com Zoom 100% */}
              <div
                className="detail-preview-box"
                onClick={() => setZoomMode((prev) => !prev)}
                style={{ cursor: zoomMode ? 'zoom-out' : 'zoom-in' }}
                title="Clique ou pressione Espaço para alternar Zoom 100%"
              >
                <div className="zoom-indicator-badge">
                  {zoomMode ? '🔍 ZOOM 100% (Clique para ajustar)' : '↔ FIT (Clique para zoom 100%)'}
                </div>
                <img
                  src={getImageUrl(selectedPhoto.path)}
                  alt={selectedPhoto.name}
                  style={{
                    transform: zoomMode ? 'scale(2.4)' : 'none',
                    transformOrigin: 'center center'
                  }}
                />
              </div>

              {/* Face Strip (Barra de Rostos) */}
              <div className="face-strip-section">
                <div className="section-label">
                  <span>Rostos na Cena ({selectedPhoto.isKissingOrClose ? 'Beijo/Pose' : 'Inspeção 100%'})</span>
                  <span style={{ color: selectedPhoto.eyesOpen ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {selectedPhoto.eyesOpen ? 'Olhos Abertos' : 'Alerta de Piscada'}
                  </span>
                </div>
                <div className="face-crops-list">
                  <div className="face-crop-card" onClick={() => setZoomMode((p) => !p)}>
                    <img
                      src={getImageUrl(selectedPhoto.path)}
                      alt="Face crop"
                      style={{ transform: 'scale(3.2) translate(0%, -10%)' }}
                    />
                    <span
                      className="face-crop-badge"
                      style={{ color: selectedPhoto.eyesOpen ? '#10b981' : '#fa0122' }}
                    >
                      {selectedPhoto.eyesOpen ? 'Aberto' : 'Piscando'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Metadados e Controles */}
              <div className="detail-meta-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700 }}>{selectedPhoto.name}</h3>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Rajada #{selectedPhoto.groupId} • {(selectedPhoto.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                  <button
                    onClick={() => window.cullingAPI?.revealInFolder(selectedPhoto.path)}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      padding: '5px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11
                    }}
                  >
                    <ExternalLink size={12} />
                    Explorer
                  </button>
                </div>

                {/* Chips de Informações */}
                <div className="meta-stats-row">
                  <div className="meta-stat-chip">
                    <Crosshair size={12} color="var(--accent-amber)" />
                    <span>Nitidez: <strong>{Math.round(selectedPhoto.blurScore)}%</strong></span>
                  </div>
                  <div className="meta-stat-chip">
                    <Eye size={12} color={selectedPhoto.eyesOpen ? 'var(--accent-green)' : 'var(--accent-red)'} />
                    <span>{selectedPhoto.eyesOpen ? 'Olhos OK' : 'Piscada'}</span>
                  </div>
                  {selectedPhoto.isRecommended && (
                    <div className="meta-stat-chip" style={{ borderColor: 'var(--accent-green)', color: 'var(--accent-green)' }}>
                      <Sparkles size={12} />
                      <span>Top Pick</span>
                    </div>
                  )}
                </div>

                {/* Botões de Estrelas (1-5) */}
                <div className="rating-buttons-row">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      className={`star-rating-btn ${selectedPhoto.rating >= star ? 'active' : ''}`}
                      onClick={() => updateRating(star)}
                      title={`Atribuir ${star} estrelas (Tecla ${star})`}
                    >
                      <Star size={13} fill={selectedPhoto.rating >= star ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                </div>

                {/* Botões de Cores XMP */}
                <div className="color-buttons-row">
                  {[
                    { name: 'red', color: 'var(--accent-red)', label: 'Rejeitada (Tecla 6 / X)' },
                    { name: 'yellow', color: 'var(--accent-amber)', label: 'Amarelo (Tecla 7)' },
                    { name: 'green', color: 'var(--accent-green)', label: 'Aprovada (Tecla 8 / P)' },
                    { name: 'blue', color: 'var(--accent-blue)', label: 'Azul (Tecla 9)' }
                  ].map((c) => (
                    <button
                      key={c.name}
                      className={`color-tag-btn ${selectedPhoto.colorLabel === c.name ? 'active' : ''}`}
                      style={{
                        background: selectedPhoto.colorLabel === c.name ? c.color : 'var(--bg-card)',
                        border: `1px solid ${c.color}`
                      }}
                      onClick={() => updateColorLabel(c.name)}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            </aside>

            {/* Filmstrip no modo Loupe */}
            {viewMode === 'loupe' && (
              <div className="bottom-filmstrip">
                {processedPhotos.map((p, idx) => (
                  <div
                    key={p.path}
                    className={`filmstrip-thumb ${idx === selectedIndex ? 'selected' : ''}`}
                    onClick={() => setSelectedIndex(idx)}
                  >
                    <img src={getImageUrl(p.path)} alt={p.name} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rodapé com Estatísticas da Sessão e Atalhos */}
      <footer className="app-footer">
        <div className="session-summary">
          <span className="summary-pill">
            <Camera size={13} /> {counts.all} fotos
          </span>
          <span className="summary-pill">
            <Layers size={13} /> {counts.bursts} rajadas
          </span>
          <span className="summary-pill" style={{ color: 'var(--accent-green)' }}>
            <Sparkles size={13} /> {counts.picks} picks ({counts.all > 0 ? Math.round((counts.picks / counts.all) * 100) : 0}%)
          </span>
          <span className="summary-pill" style={{ color: 'var(--accent-red)' }}>
            <XCircle size={13} /> {counts.rejected} rejeitadas
          </span>
        </div>

        <div className="keyboard-hints">
          <span><span className="kbd-badge">←</span> <span className="kbd-badge">→</span> Navegar</span>
          <span><span className="kbd-badge">1-5</span> Estrelas</span>
          <span><span className="kbd-badge">P</span> Pick</span>
          <span><span className="kbd-badge">X</span> Rejeitar</span>
          <span><span className="kbd-badge">C</span> Comparar</span>
          <span><span className="kbd-badge">Espaço</span> Zoom</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-green)' }}>
          <CheckCircle size={13} />
          <span>XMP Sync Ativo</span>
        </div>
      </footer>
    </div>
  );
}
