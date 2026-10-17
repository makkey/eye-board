import type { Dir, GazeClass, Lang } from './types';

/** 画面と読み上げの文言。{name} のような箇所は t() の vars で埋める */
const JA = {
  'nav.lang': '言語: 日本語',
  'nav.langAria': '入力する言語を切り替える',
  'nav.calibrate': 'キャリブレーション',
  'nav.debug': 'デバッグ',
  'nav.settings': '設定',
  'text.aria': '入力したテキスト',
  'text.placeholder': 'ここに入力されます',
  'btn.speak': '🔊 読み上げ',
  'btn.copy': 'コピー',
  'btn.undo': '元に戻す',
  'btn.clear': '全消去',
  'gaze.aria': '現在の視線方向',
  'gaze.closed': '閉／下',
  'status.ready': '準備中',
  'help.summary': '使い方',
  'help.body': `<ol>
  <li>顔がカメラに正面から映るように置き、<b>キャリブレーション</b>を行います（音声で案内します）。</li>
  <li>行を選ぶ：↖ あ・↑ か・↗ さ・← た・→ は を見る（約0.4秒）→ 読み上げを聞いたら<b>画面に視線を戻す</b>と確定。</li>
  <li>同じ方向を<b>2秒</b>見続けると ↖ ま・↑ や・↗ ら・← わ・→ 編集（続けて → で削除）。短く見て選んだ時と2秒で切り替わった時は、違う音が鳴ります。</li>
  <li><b>目を閉じる（または下を見る）</b>：0.6秒で「な行」、そのまま2秒で「記号」。読み上げを聞いたら目を開けます。</li>
  <li>文字を選ぶ：<b>左から時計回りに あ・い・う・え・お</b>（← ↖ ↑ ↗ →）。見て戻ると確定。</li>
  <li>何も選ばずに戻る：2段目で<b>目を閉じる（下を見る）</b>。5秒何もしなくても戻ります。</li>
</ol>
<p>右上の「言語」で英語に切り替えられます。</p>
<p>シミュレーション：<kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd>/<kbd>A</kbd><kbd>D</kbd>（または矢印キー）を押している間その方向を見ている扱い、<kbd>Space</kbd>（または<kbd>X</kbd>・<kbd>↓</kbd>）で目を閉じる。</p>
<p>映像は端末内でのみ処理され、送信されません。</p>`,
  'start.desc': '目を大きく動かして、12キー配列でひらがなを入力します。<br />画面から目をそらして使うので、<b>音声の案内</b>を聞きながら操作します。',
  'start.camera': 'カメラで始める',
  'start.sim': 'キーボードで試す',
  'start.otherLang': 'English',
  'calib.stop': '中止',
  'settings.title': '設定',
  'settings.reset': '既定値に戻す',
  'settings.forgetCal': 'キャリブレーションを削除',
  'settings.close': '閉じる',
  'set.selectMs': '候補になるまで（ms）',
  'set.longMs': '長く見る・閉じる（ms）',
  'set.closeMinMs': '目を閉じて選択（ms）',
  'set.idleMs': '無操作キャンセル（ms）',
  'set.debounceMs': '揺れの無視（ms）',
  'set.smoothing': '平滑化（1 = なし）',
  'set.hysteresis': '方向切替の粘り（小 = 粘る）',
  'set.centerBias': '中央の広さ（小 = 広い）',
  'set.closedBias': '閉じた判定の広さ（小 = 閉じたと判定しやすい）',
  'set.ttsRate': '読み上げ速度',
  'set.tts': '読み上げ',
  'set.sound': '効果音',
  'debug.copyCal': 'キャリブレーション結果をコピー',
  'mode.sim': 'キーボード操作',
  'mode.camera': 'カメラ',
  'mode.cameraUncal': 'カメラ（未キャリブレーション）',
  'key.closeHint': '目を閉じる／下',
  'key.long': '2秒: {label}',
  'key.space': 'スペース',
  'char.back': 'もどる',
  'st.trackerStopped': '顔認識が止まっています',
  'st.noFace': '顔が見つかりません',
  'st.noFaceSub': 'カメラに顔が正面から映るようにしてください',
  'st.closed': '目を閉じています',
  'st.keepClosedFor': 'そのまま閉じていると {name}',
  'st.keepClosedBack': 'そのまま閉じていると、もどる',
  'st.wentBack': 'もどりました。目を開けてください',
  'st.selectedCanSwitch': '{name}。そのまま閉じていると {long}',
  'st.selectedOpen': '{name}。目を開けてください',
  'st.confirm': '画面に視線を戻すと確定',
  'st.keepLooking': '（見続けると {name}）',
  'st.chooseRow': '行を選ぶ',
  'st.chooseRowSub': '方向を見る → 戻る　／　目を閉じる（下を見る）→ {name}',
  'st.chooseItem': '{row} — 文字を選ぶ',
  'st.chooseItemSub': '← ↖ ↑ ↗ → を見て戻る　／　目を閉じる（下を見る）→ もどる',
  'st.quote': '「{x}」',
  'cam.starting': 'カメラを起動中…',
  'cam.loadingModel': '顔認識モデルを読み込み中…',
  'cam.failed': 'カメラを開始できませんでした: {msg}',
  'cal.preparing': '顔認識を準備中…',
  'cal.notStarted': '顔認識が動き始めませんでした。',
  'cal.weak': '次の区別がつきにくい結果でした：{list}\n明るさやカメラの位置を変えて、もう一度試すと改善するかもしれません。',
  'cal.recording': '　記録中…',
  'cal.intro': 'キャリブレーションを始めます。顔は動かさず、目だけを大きく動かしてください。',
  'cal.done': 'キャリブレーションが完了しました',
  'cal.center': '画面の中央を見てください',
  'cal.closed': '目を閉じてください。音が鳴ったら開けてください',
  'cal.down': '下を見てください',
  'cal.look': '{dir}を見てください',
  'cal.noFrames': 'カメラの映像を顔認識に渡せていません。',
  'cal.lostFace': '顔を見失うことが多すぎました。カメラの位置や明るさを確認してください。',
  'cal.fewSamples': '「{name}」の記録がほとんど取れませんでした（{n} フレーム）。',
  'dir.C': '中央',
  'dir.UL': '左上',
  'dir.U': '上',
  'dir.UR': '右上',
  'dir.L': '左',
  'dir.R': '右',
  'cls.closed': '閉じる',
  'diag.delegate': '処理',
  'diag.frames': '処理したフレーム',
  'diag.video': '映像',
  'diag.error': 'エラー',
  'diag.none': 'なし',
  'diag.bad': '数値にならないフレーム',
  'copy.noCal': 'まだキャリブレーションしていません',
  'copy.done': 'コピーしました。チャットに貼り付けてください。',
  'copy.manual': 'コピーできませんでした。以下を手動でコピーしてください。',
  'dbg.uncal': '（未キャリブレーション）',
  'dbg.tracker': '顔認識',
  'dbg.class': '判定',
  'dbg.stable': '安定',
  'dbg.header': 'クラス  距離   キャリブ精度',
  'say.cancel': 'キャンセル',
  'say.back': 'もどる',
  'say.empty': '何も入力されていません',
  'lang.name': '日本語',
};

export type TextKey = keyof typeof JA;

const EN: Record<TextKey, string> = {
  'nav.lang': 'Language: English',
  'nav.langAria': 'Switch input language',
  'nav.calibrate': 'Calibrate',
  'nav.debug': 'Debug',
  'nav.settings': 'Settings',
  'text.aria': 'Typed text',
  'text.placeholder': 'Your text appears here',
  'btn.speak': '🔊 Speak',
  'btn.copy': 'Copy',
  'btn.undo': 'Undo',
  'btn.clear': 'Clear',
  'gaze.aria': 'Current gaze direction',
  'gaze.closed': 'Closed',
  'status.ready': 'Getting ready',
  'help.summary': 'How to use',
  'help.body': `<ol>
  <li>Place the device so the camera sees your face straight on, then <b>calibrate</b> (spoken guidance).</li>
  <li>Choose a group: look ↖ ABCDE · ↑ FGHIJ · ↗ KLMNO · ← PQRST · → UVWXY (about 0.4 s). When you hear it, <b>look back at the screen</b> to confirm.</li>
  <li>Keep looking for <b>2 s</b> for ↖ 1–5 · ↑ 6–0 · ↗ !-:;" · ← ()/@& · → Edit (then → again to delete). A short look and the 2 s switch play different sounds.</li>
  <li><b>Close your eyes (or look down)</b>: a space at 0.6 s; keep them closed for 2 s for . , ? ' Z (the space is taken back).</li>
  <li>Choose a letter: <b>clockwise from the left</b> (← ↖ ↑ ↗ →), e.g. ←A ↖B ↑C ↗D →E. Look and come back to confirm.</li>
  <li>Go back without choosing: <b>close your eyes (look down)</b> on the second level. Doing nothing for 5 s also goes back.</li>
  <li>Sentence starts and a standalone “i” are capitalized automatically. “Aa” in Edit toggles the case of the last letter.</li>
</ol>
<p>Switch to Japanese with “Language” at the top right.</p>
<p>Simulation: hold <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd>/<kbd>A</kbd><kbd>D</kbd> (or the arrow keys) to look in that direction, and <kbd>Space</kbd> (or <kbd>X</kbd>/<kbd>↓</kbd>) to close your eyes.</p>
<p>The video is processed on this device only and is never sent anywhere.</p>`,
  'start.desc': 'Type letters by moving your eyes widely.<br />You look away from the screen, so follow the <b>spoken guidance</b>.',
  'start.camera': 'Start with camera',
  'start.sim': 'Try with keyboard',
  'start.otherLang': '日本語',
  'calib.stop': 'Stop',
  'settings.title': 'Settings',
  'settings.reset': 'Reset to defaults',
  'settings.forgetCal': 'Delete calibration',
  'settings.close': 'Close',
  'set.selectMs': 'Time to select (ms)',
  'set.longMs': 'Long look / long close (ms)',
  'set.closeMinMs': 'Close eyes to select (ms)',
  'set.idleMs': 'Cancel when idle (ms)',
  'set.debounceMs': 'Ignore jitter (ms)',
  'set.smoothing': 'Smoothing (1 = none)',
  'set.hysteresis': 'Direction stickiness (smaller = stickier)',
  'set.centerBias': 'Center size (smaller = wider)',
  'set.closedBias': 'Closed-eye sensitivity (smaller = detected more easily)',
  'set.ttsRate': 'Speech rate',
  'set.tts': 'Speech',
  'set.sound': 'Sound effects',
  'debug.copyCal': 'Copy calibration result',
  'mode.sim': 'Keyboard',
  'mode.camera': 'Camera',
  'mode.cameraUncal': 'Camera (not calibrated)',
  'key.closeHint': 'Close / look down',
  'key.long': '2s: {label}',
  'key.space': 'Space',
  'char.back': 'Back',
  'st.trackerStopped': 'Face tracking has stopped',
  'st.noFace': 'No face found',
  'st.noFaceSub': 'Face the camera directly',
  'st.closed': 'Eyes closed',
  'st.keepClosedFor': 'Keep them closed for {name}',
  'st.keepClosedBack': 'Keep them closed to go back',
  'st.wentBack': 'Went back. Open your eyes',
  'st.selectedCanSwitch': '{name}. Keep closed for {long}',
  'st.selectedOpen': '{name}. Open your eyes',
  'st.confirm': 'Look back at the screen to confirm',
  'st.keepLooking': ' (keep looking for {name})',
  'st.chooseRow': 'Choose a group',
  'st.chooseRowSub': 'Look a direction, then back · Close eyes (look down) → {name}',
  'st.chooseItem': '{row} — choose a letter',
  'st.chooseItemSub': 'Look ← ↖ ↑ ↗ →, then back · Close eyes (look down) → back',
  'st.quote': '“{x}”',
  'cam.starting': 'Starting camera…',
  'cam.loadingModel': 'Loading face model…',
  'cam.failed': 'Could not start the camera: {msg}',
  'cal.preparing': 'Preparing face tracking…',
  'cal.notStarted': 'Face tracking did not start.',
  'cal.weak': 'These were hard to tell apart: {list}\nChanging the lighting or camera position and calibrating again may help.',
  'cal.recording': '  Recording…',
  'cal.intro': 'Starting calibration. Keep your head still and move only your eyes, widely.',
  'cal.done': 'Calibration complete',
  'cal.center': 'Look at the center of the screen',
  'cal.closed': 'Close your eyes. Open them at the beep',
  'cal.down': 'Look down',
  'cal.look': 'Look {dir}',
  'cal.noFrames': 'The camera image is not reaching face tracking.',
  'cal.lostFace': 'The face was lost too often. Check the camera position and lighting.',
  'cal.fewSamples': 'Almost nothing was recorded for “{name}” ({n} frames).',
  'dir.C': 'center',
  'dir.UL': 'up-left',
  'dir.U': 'up',
  'dir.UR': 'up-right',
  'dir.L': 'left',
  'dir.R': 'right',
  'cls.closed': 'closed',
  'diag.delegate': 'Backend',
  'diag.frames': 'Frames',
  'diag.video': 'Video',
  'diag.error': 'Error',
  'diag.none': 'none',
  'diag.bad': 'Invalid frames',
  'copy.noCal': 'Not calibrated yet',
  'copy.done': 'Copied.',
  'copy.manual': 'Could not copy. Please copy the text below.',
  'dbg.uncal': ' (not calibrated)',
  'dbg.tracker': 'tracker',
  'dbg.class': 'class',
  'dbg.stable': 'stable',
  'dbg.header': 'class   dist   calib acc',
  'say.cancel': 'cancel',
  'say.back': 'back',
  'say.empty': 'nothing typed',
  'lang.name': 'English',
};

const TEXTS: Record<Lang, Record<TextKey, string>> = { ja: JA, en: EN };

let current: Lang = 'ja';

/** 画面の言語。入力の言語と同じにする */
export function setLang(lang: Lang) {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function t(key: TextKey, vars: Record<string, string | number> = {}): string {
  return TEXTS[current][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export function dirName(dir: Dir): string {
  return t(`dir.${dir}` as TextKey);
}

export function className(cls: GazeClass): string {
  return cls === 'closed' ? t('cls.closed') : dirName(cls);
}

/** HTML の data-i18n 系の属性に従って、静的な文言を差し替える */
export function applyStaticTexts(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as TextKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml as TextKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder as TextKey));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as TextKey));
  });
}
