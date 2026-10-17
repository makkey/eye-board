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
  <li>同じ方向を<b>2秒</b>見続けると ↖ ま・↑ や・↗ ら・← 編集（続けて ← で削除）・→ わ。短く見て選んだ時と2秒で切り替わった時は、違う音が鳴ります。</li>
  <li><b>目を閉じる（または下を見る）</b>：0.6秒で「な行」、そのまま2秒で「記号」。読み上げを聞いたら目を開けます。</li>
  <li>文字を選ぶ：<b>左から時計回りに あ・い・う・え・お</b>（← ↖ ↑ ↗ →）。見て戻ると確定。</li>
  <li>何も選ばずに戻る：2段目で<b>目を閉じる（下を見る）</b>。5秒何もしなくても戻ります。</li>
</ol>
<p>右上の「言語」で、日本語（12キー）→ 日本語（母音入力）→ 英語 の順に切り替わります。</p>
<p><b>母音入力</b>：各拍の母音だけを入れ、文節ごとに AI が漢字かな交じりに変換します（例：「きのうは」→ い・お・う・あ）。</p>
<ol>
  <li>文頭の<b>最初の1文字だけ</b>は、12キーと同じく行 → 文字で入れます（「生卵」なら な）。濁点や小さい字は付けなくて構いません（か を選べば が・きょ も候補になります）。設定で「すべての文節」「しない」にも変えられます。</li>
  <li>← あ・↖ い・↑ う・↗ え・→ お を見て戻ると1拍入ります。ん は ↖ を2秒。っ は次の音の母音、ー は前の音の母音で入れます（とって → お・え・え）。</li>
  <li>1文節（「昨日は」など）入れたら<b>目を閉じる</b>と変換。候補が ← ↖ ↑ ↗ → に並ぶので、見て戻ると確定します。どれも違う時は<b>目を閉じる</b>と、まだ出ていない別の候補を聞き直します。<b>2秒閉じ続ける</b>と入力にもどります（入れた母音は残ります）。</li>
  <li><b>区切りは文節ごと</b>：「ね」を挟んで自然に切れるところ（助詞の後ろ）で区切ります。例：昨日は｜楽しかったね｜ありがとう、お水を｜ください。1つの区切りに2つの文節を入れないでください。思い通りに出ない時は、単語の切れ目や助詞の前でも区切れます（なま｜たまご｜が｜たべたい）。区切りが細かいほど、AI の当て先が絞られます。</li>
  <li>→ を2秒で<b>文節の区切り</b>。区切って次の文節も入れてから変換すると、まとめて変換します（「生卵が 食べたい」のように、後ろの文節が手がかりになって文頭の言葉が当たりやすくなります）。</li>
  <li>← を2秒で編集（続けて ← で1拍削除）、目を閉じ続けると記号（、。？！改行）。</li>
  <li>設定で AI の会社と API キーを入れて使います（キーはこのブラウザだけに保存）。</li>
</ol>
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
  'nav.langVowel': '入力: 母音（AI変換）',
  'lang.nameVowel': '母音入力',
  'set.aiSection': '母音入力（AI 変換）',
  'set.jaInput': '日本語の入力方式',
  'set.jaInput.kana': '12キー（行と段を選ぶ）',
  'set.jaInput.vowel': '母音入力（AI が変換）',
  'set.aiProvider': 'AI の会社',
  'set.aiModel': 'モデル',
  'set.aiKey': 'API キー',
  'set.aiKeyNote': 'API キーはこのブラウザの中だけに保存され（母音ラボと共通）、選んだ会社の API に直接送られます。変換のたびに API の利用料金がかかります。',
  'set.aiEffort': '考える深さ（浅いほど速い）',
  'set.aiEffort.default': 'モデルの既定',
  'set.aiRuns': '同時に聞く回数（多いほど安定・料金は回数倍）',
  'jv.chooseVowel': '母音を入力',
  'jv.chooseHead': '最初の1文字を選ぶ',
  'jv.chooseHeadSub': '12キーと同じく 行 → 文字（濁点は不要）。2文字目からは母音だけ',
  'set.aiHead': '最初の1文字を12キーで入れる',
  'set.aiHead.start': '文頭の文節だけ',
  'set.aiHead.all': 'すべての文節',
  'set.aiHead.off': 'しない（母音だけ）',
  'jv.chooseVowelSub': '← あ ↖ い ↑ う ↗ え → お　／　→ 2秒で文節の区切り　／　目を閉じる → 変換',
  'jv.pending': '入力中：{v}',
  'jv.waiting': '変換中…',
  'jv.waitingSub': '目を閉じる（下を見る）→ やめる',
  'jv.choose': '候補を選ぶ',
  'jv.chooseSub': '← ↖ ↑ ↗ → を見て戻る　／　目を閉じる（下を見る）→ 別の候補（2秒で入力にもどる）',
  'jv.more': '別の候補',
  'jv.noMore': 'ほかの候補が見つかりませんでした',
  'jv.keepClosedMore': 'そのまま閉じていると 別の候補（2秒で入力にもどる）',
  'jv.candidates': '候補',
  'jv.candidatesSay': '候補。{first}',
  'jv.noVowels': '母音が入力されていません',
  'jv.noKey': 'API キーが設定されていません。設定から入力してください',
  'jv.noCandidates': '候補が見つかりませんでした',
  'jv.error': '変換できませんでした（{msg}）',
  'jv.convertFirst': '先に変換してください',
  'jv.cancelled': '変換をやめました',
  'jv.backToInput': '入力にもどる',
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
  <li>Keep looking for <b>2 s</b> for ↖ 1–5 · ↑ 6–0 · ↗ !-:;" · ← Edit (then ← again to delete) · → ()/@&. A short look and the 2 s switch play different sounds.</li>
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
  'nav.langVowel': 'Input: Japanese vowels (AI)',
  'lang.nameVowel': 'Japanese vowel input',
  'set.aiSection': 'Japanese vowel input (AI conversion)',
  'set.jaInput': 'Japanese input method',
  'set.jaInput.kana': '12-key (row, then vowel)',
  'set.jaInput.vowel': 'Vowels only (AI converts)',
  'set.aiProvider': 'AI provider',
  'set.aiModel': 'Model',
  'set.aiKey': 'API key',
  'set.aiKeyNote': 'The API key is stored only in this browser (shared with the vowel lab) and sent directly to the chosen provider. Each conversion is billed by the provider.',
  'set.aiEffort': 'Thinking depth (lower is faster)',
  'set.aiEffort.default': 'Model default',
  'set.aiRuns': 'Parallel requests (steadier, costs more)',
  'jv.chooseVowel': 'Enter vowels',
  'jv.chooseHead': 'Choose the first kana',
  'jv.chooseHeadSub': 'Row, then kana, as on the 12-key layout (no dakuten needed). Vowels only after that',
  'set.aiHead': 'Enter the first kana with the 12-key layout',
  'set.aiHead.start': 'First phrase of a sentence',
  'set.aiHead.all': 'Every phrase',
  'set.aiHead.off': 'Never (vowels only)',
  'jv.chooseVowelSub': '← a ↖ i ↑ u ↗ e → o · Hold → 2s for a phrase break · Close eyes → convert',
  'jv.pending': 'Typing: {v}',
  'jv.waiting': 'Converting…',
  'jv.waitingSub': 'Close eyes (look down) → stop',
  'jv.choose': 'Choose a candidate',
  'jv.chooseSub': 'Look ← ↖ ↑ ↗ →, then back · Close eyes (look down) → more candidates (2s: back to input)',
  'jv.more': 'More',
  'jv.noMore': 'No other candidates found',
  'jv.keepClosedMore': 'Keep closed for more candidates (2s: back to input)',
  'jv.candidates': 'Candidates',
  'jv.candidatesSay': 'Candidates. {first}',
  'jv.noVowels': 'No vowels entered',
  'jv.noKey': 'No API key. Enter one in Settings',
  'jv.noCandidates': 'No candidates found',
  'jv.error': 'Could not convert ({msg})',
  'jv.convertFirst': 'Convert first',
  'jv.cancelled': 'Conversion stopped',
  'jv.backToInput': 'Back to input',
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
