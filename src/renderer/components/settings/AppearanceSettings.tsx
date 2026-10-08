import { useState } from 'react'
import { Check, ImagePlus, Monitor, Moon, Palette, PanelBottomClose, PanelLeftClose, Quote, RotateCcw, Rows3, Sun, Type } from 'lucide-react'
import { motion } from 'motion/react'
import { useInterface } from '../../stores/interface'
import { useWorkbench } from '../../stores/workbench'
import { fontSizes, type BackgroundStyle } from '../../../shared/interface'
import { Button } from '../ui/button'

const backgrounds: { id: BackgroundStyle; label: string }[] = [
  { id: 'default', label: '默认' }, { id: 'mist', label: '晨雾' }, { id: 'sage', label: '青绿' }, { id: 'dusk', label: '暮色' },
  { id: 'midnight', label: '极夜黑' }, { id: 'klein', label: '克莱因蓝' },
  { id: 'orange', label: '暖橙' }, { id: 'yellow', label: '杏黄' }, { id: 'red', label: '陶红' }, { id: 'pink', label: '柔粉' }
]
const sizeLabels = ['较小', '默认', '较大', '特大']
export function AppearanceSettings() {
  const { preferences, backgroundDataUrl, loaded, saving, uploading, error, update, upload } = useInterface()
  const appearance = useWorkbench((state) => state.appearance)
  const setAppearance = useWorkbench((state) => state.setAppearance)
  const [notice, setNotice] = useState('')
  return <section className="appearance-section" id="appearance-settings" aria-labelledby="appearance-heading">
    <div className="storage-section-heading"><Palette size={19} /><div><h2 id="appearance-heading">外观与显示</h2><p>调整背景与文字，让工作台更适合你的阅读习惯。</p></div></div>
    <div className="appearance-card">
      <div className="appearance-setting theme-setting"><div><h3>显示模式</h3><p>浅色、深色，或跟随系统。</p></div>
        <div className="appearance-segments" role="group" aria-label="显示模式">
          {([{ id: 'light', label: '浅色', icon: Sun }, { id: 'dark', label: '深色', icon: Moon }, { id: 'system', label: '跟随系统', icon: Monitor }] as const).map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={appearance === id} onClick={() => void setAppearance(id)}>
            {appearance === id && <motion.span layoutId="settings-theme" className="appearance-selection" />}
            <Icon size={15} /><span>{label}</span>
          </button>)}
        </div>
      </div>
      <div className="appearance-setting background-setting">
          <div className="appearance-setting-heading"><div><h3>软件背景</h3><p>选择内置配色，或换成自己的图片。</p></div>
          <Button disabled={!loaded || saving} onClick={async () => { setNotice(''); if (await upload()) setNotice('背景已更换，原图片保留在原位置。') }}><ImagePlus size={16} />上传背景</Button>
        </div>
        <div className="background-options" role="group" aria-label="软件背景">
          {backgrounds.map(({ id, label }) => <button key={id} className="background-option" disabled={!loaded || uploading} aria-pressed={preferences.background === id} aria-label={`${label}背景`} onClick={() => { setNotice(''); void update({ background: id }) }}>
            <span className={`background-preview wallpaper-${id}`}>{preferences.background === id && <span className="background-check"><Check size={14} /></span>}</span><span>{label}</span>
          </button>)}
          {backgroundDataUrl && <button className="background-option" disabled={!loaded || uploading} aria-label="自定义背景" aria-pressed={preferences.background === 'custom'} onClick={() => { setNotice(''); void update({ background: 'custom' }) }}>
            <span className="background-preview" style={{ backgroundImage: `url("${backgroundDataUrl}")` }}>{preferences.background === 'custom' && <span className="background-check"><Check size={14} /></span>}</span><span>自定义</span>
          </button>}
        </div>
        <div className="background-caption"><span>{preferences.background === 'custom' ? preferences.backgroundName || '自定义图片' : '支持 JPG、PNG，最大 20 MB。图片仅保存在本机。'}</span>
          {preferences.background !== 'default' && <button disabled={uploading} onClick={() => void update({ background: 'default' })}><RotateCcw size={12} />恢复默认背景</button>}
        </div>
        {preferences.backgroundFile && !backgroundDataUrl && <p className="field-error">原背景图片暂时无法读取，已使用默认背景；可以重新上传。</p>}
      </div>
      <div className="appearance-setting opacity-setting">
        <div className="appearance-setting-heading"><div><h3>页面透明度</h3><p>调整周边面板的透光程度；核心工作区保持清晰易读。</p></div><output htmlFor="panel-transparency">{100 - preferences.panelOpacity}%</output></div>
        <input id="panel-transparency" aria-label="页面透明度" type="range" min="0" max="80" step="1" value={100 - preferences.panelOpacity} disabled={!loaded || uploading} onChange={(event) => void update({ panelOpacity: 100 - Number(event.target.value) })} />
        <div className="opacity-labels"><span>不透明</span><button onClick={() => void update({ panelOpacity: 95 })}>恢复默认</button><span>更通透</span></div>
      </div>
      <div className="appearance-setting font-setting">
        <div className="appearance-setting-heading"><div><h3>界面字号</h3><p>立即预览，导航、任务、文献卡片和设置一起调整。</p></div><Type size={20} className="setting-type-icon" /></div>
        <div className="font-size-options" role="group" aria-label="界面字号">
          {fontSizes.map((size, index) => <button key={size} disabled={!loaded || uploading} aria-pressed={preferences.fontSize === size} aria-label={`${sizeLabels[index]}字号 ${size}`} onClick={() => { setNotice(''); void update({ fontSize: size }) }}>
            {preferences.fontSize === size && <motion.span layoutId="settings-font-size" className="appearance-selection" />}
            <span className={`font-sample font-sample-${size}`}>文</span><span>{sizeLabels[index]}</span><small>{size}</small>
          </button>)}
        </div>
        <div className="font-reading-preview"><strong>让每一次阅读，都更从容。</strong><p>研究计划、文献笔记与下一步想法，在这里清晰呈现。</p><span>PDF 原文使用阅读器内的独立缩放。</span></div>
      </div>
      <div className="appearance-setting density-setting">
        <div className="appearance-setting-heading"><div><h3>工作区密度</h3><p>紧凑模式缩短标题区和外围留白；侧栏与每日鼓励语可单独收起。</p></div><Rows3 size={20} className="setting-type-icon" /></div>
        <div className="display-toggle-grid">
          <button type="button" aria-pressed={preferences.compactMode} onClick={() => void update({ compactMode: !preferences.compactMode })}><Rows3 size={16} /><span><strong>紧凑模式</strong><small>{preferences.compactMode ? '已启用' : '舒适布局'}</small></span></button>
          <button type="button" aria-pressed={preferences.sidebarCollapsed} onClick={() => void update({ sidebarCollapsed: !preferences.sidebarCollapsed })}><PanelLeftClose size={16} /><span><strong>收起侧栏</strong><small>{preferences.sidebarCollapsed ? '已收起' : '已展开'}</small></span></button>
          <button type="button" aria-pressed={preferences.encouragementHidden} onClick={() => void update({ encouragementHidden: !preferences.encouragementHidden })}><Quote size={16} /><span><strong>隐藏每日鼓励语</strong><small>{preferences.encouragementHidden ? '已隐藏' : '正在显示'}</small></span></button>
          <button type="button" aria-pressed={preferences.dockAutoHide} onClick={() => void update({ dockAutoHide: !preferences.dockAutoHide })}><PanelBottomClose size={16} /><span><strong>自动隐藏 Dock</strong><small>{preferences.dockAutoHide ? '移至底缘时显示' : '始终显示'}</small></span></button>
        </div>
      </div>
    </div>
    <div className="appearance-feedback" role="status">{error ? <span className="field-error">{error}</span> : saving ? '正在保存外观…' : <><Check size={14} />{notice || '更改自动保存，重新打开后继续使用。'}</>}</div>
  </section>
}
