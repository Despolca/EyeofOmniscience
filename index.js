/* ============ Toàn Thị Chi Nhãn · Lớp tương thích extension ============
   Thay 4 interface vốn phụ thuộc vào "Tavern Assistant" thành bản hiện thực nội bộ (native), signature giữ nguyên,
   phần thân script bên dưới không cần sửa dù chỉ một dòng:
     getWorldbook(name)                     -> WorldbookEntry[]
     updateWorldbookWith(name, updater)     -> WorldbookEntry[]
     createWorldbookEntries(name, entries)  -> { worldbook, new_entries }
     getCharData('current')                 -> Đối tượng nhân vật | null

   Việc đọc/ghi Worldbook ưu tiên thông qua module của chính Tavern (dùng chung worldInfoCache, sau khi ghi editor sẽ không bị đọc phải dữ liệu cũ),
   khi phát hiện đường dẫn module thất bại thì fallback về /api/worldinfo/get và /api/worldinfo/edit.
   ================================================ */

let EYE_WI = null;          // Module Worldbook, false biểu thị đã dò tìm nhưng không lấy được

/* Lưu ý: Không thể cache giá trị trả về của getContext(). Nó trả về đối tượng mới mỗi lần gọi,
   nếu cache lại thì characterId / chatId sẽ chỉ là snapshot tại thời điểm mở trang, sau khi đổi card sẽ luôn lấy phải card cũ. */
function eyeCtx() {
  try {
    if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
      return window.SillyTavern.getContext();
    }
  } catch (e) {}
  return null;
}

async function eyeWorldModule() {
  if (EYE_WI !== null) return EYE_WI;
  // Extension của người dùng nằm ở thư mục /scripts/extensions/third-party/<thư_mục>/,
  // nên cần lùi 3 cấp mới về tới /scripts/; giữ thêm một phương án dự phòng lùi 2 cấp phòng khi điểm gắn (mount point) thay đổi.
  const paths = ['../../../world-info.js', '../../world-info.js'];
  for (const p of paths) {
    try {
      const m = await import(p);
      if (m && typeof m.loadWorldInfo === 'function' && typeof m.saveWorldInfo === 'function') {
        EYE_WI = m;
        return EYE_WI;
      }
    } catch (e) {}
  }
  EYE_WI = false;
  return null;
}

function eyeHeaders() {
  const ctx = eyeCtx();
  if (ctx && typeof ctx.getRequestHeaders === 'function') return ctx.getRequestHeaders();
  return { 'Content-Type': 'application/json' };
}

async function eyeReadRaw(name) {
  const m = await eyeWorldModule();
  if (m) {
    try {
      const d = await m.loadWorldInfo(name);
      if (d && d.entries) return d;
    } catch (e) {}
  }
  try {
    const r = await fetch('/api/worldinfo/get', {
      method: 'POST',
      headers: eyeHeaders(),
      body: JSON.stringify({ name: name }),
      cache: 'no-cache',
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.entries ? d : null;
  } catch (e) {
    return null;
  }
}

async function eyeWriteRaw(name, data) {
  const m = await eyeWorldModule();
  if (m) {
    await m.saveWorldInfo(name, data, true);
    return true;
  }
  try {
    const r = await fetch('/api/worldinfo/edit', {
      method: 'POST',
      headers: eyeHeaders(),
      body: JSON.stringify({ name: name, data: data }),
    });
    return !!r.ok;
  } catch (e) {
    return false;
  }
}

/* ---------- Chuyển đổi định dạng: SillyTavern gốc <-> Cấu trúc script sử dụng ---------- */

const EYE_POS_TO_NAME = {
  0: 'before_character_definition',
  1: 'after_character_definition',
  5: 'before_example_messages',
  6: 'after_example_messages',
  2: 'before_author_note',
  3: 'after_author_note',
  4: 'at_depth',
  7: 'outlet',
};
const EYE_NAME_TO_POS = {
  before_character_definition: 0,
  after_character_definition: 1,
  before_example_messages: 5,
  after_example_messages: 6,
  before_author_note: 2,
  after_author_note: 3,
  at_depth: 4,
  outlet: 7,
};
const EYE_ROLE_TO_NAME = { 0: 'system', 1: 'user', 2: 'assistant' };
const EYE_NAME_TO_ROLE = { system: 0, user: 1, assistant: 2 };
const EYE_LOGIC_TO_NAME = { 0: 'and_any', 1: 'not_all', 2: 'not_any', 3: 'and_all' };
const EYE_NAME_TO_LOGIC = { and_any: 0, not_all: 1, not_any: 2, and_all: 3 };

function eyeToEntry(o) {
  const e = {
    uid: o.uid,
    name: o.comment || '',
    enabled: !o.disable,
    strategy: {
      type: o.constant ? 'constant' : o.vectorized ? 'vectorized' : 'selective',
      keys: Array.isArray(o.key) ? o.key.slice() : [],
      keys_secondary: {
        logic: EYE_LOGIC_TO_NAME[o.selectiveLogic] || 'and_any',
        keys: Array.isArray(o.keysecondary) ? o.keysecondary.slice() : [],
      },
      scan_depth: o.scanDepth === null || o.scanDepth === undefined ? 'same_as_global' : o.scanDepth,
    },
    position: {
      type: EYE_POS_TO_NAME[o.position],
      role: EYE_ROLE_TO_NAME[o.role === null || o.role === undefined ? 0 : o.role],
      depth: typeof o.depth === 'number' ? o.depth : 4,
      order: typeof o.order === 'number' ? o.order : 100,
    },
    content: typeof o.content === 'string' ? o.content : '',
    probability: o.useProbability ? o.probability : 100,
    recursion: {
      prevent_incoming: !!o.excludeRecursion,
      prevent_outgoing: !!o.preventRecursion,
      delay_until: typeof o.delayUntilRecursion === 'number' && o.delayUntilRecursion > 0 ? o.delayUntilRecursion : null,
    },
    effect: {
      sticky: typeof o.sticky === 'number' && o.sticky > 0 ? o.sticky : null,
      cooldown: typeof o.cooldown === 'number' && o.cooldown > 0 ? o.cooldown : null,
      delay: typeof o.delay === 'number' && o.delay > 0 ? o.delay : null,
    },
  };
  if (o.extra) e.extra = o.extra;
  return e;
}

function eyeNewRaw(uid, displayIndex) {
  return {
    uid: uid,
    displayIndex: displayIndex,
    comment: '',
    disable: false,
    constant: true,
    selective: false,
    key: [],
    selectiveLogic: 0,
    keysecondary: [],
    scanDepth: null,
    vectorized: false,
    position: 1,
    role: 0,
    depth: 4,
    order: 100,
    content: '',
    useProbability: true,
    probability: 100,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    sticky: null,
    cooldown: null,
    delay: null,
    addMemo: true,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    ignoreBudget: false,
    outletName: '',
    triggers: [],
    characterFilter: { isExclude: false, names: [], tags: [] },
  };
}

/* Lấy đối tượng gốc làm nền tảng, chỉ map ngược lại các trường đã bị script chỉnh sửa.
   Nguyên tắc: Giá trị không đổi thì không động vào dù chỉ một byte. Các trường lạ mà ta không quản lý trong đối tượng gốc
   (displayIndex, addMemo, triggers...) đều giữ nguyên như cũ. */
function eyeApplyToRaw(o, e) {
  const r = Object.assign({}, o);
  if (e.uid !== undefined && e.uid !== null && Number(e.uid) !== Number(o.uid)) r.uid = Number(e.uid);
  if (e.name !== undefined && e.name !== o.comment) r.comment = e.name;
  if (e.enabled !== undefined && !!e.enabled !== !o.disable) r.disable = !e.enabled;

  const st = e.strategy;
  if (st) {
    if (st.type !== undefined) {
      const constant = st.type === 'constant';
      const vectorized = st.type === 'vectorized';
      /* type chỉ có 3 mức, không thể suy ngược ra selective (trong ST nó là công tắc "selective logic", không liên quan đến việc có thường trực hay không),
         do đó mục này giữ nguyên như cũ, không động vào cấu hình của người dùng. */
      if (constant !== !!o.constant) r.constant = constant;
      if (vectorized !== !!o.vectorized) r.vectorized = vectorized;
    }
    if (Array.isArray(st.keys)) {
      const keys = st.keys.map(String);
      if (JSON.stringify(keys) !== JSON.stringify(o.key || [])) r.key = keys;
    }
    if (st.keys_secondary) {
      const s = st.keys_secondary;
      if (s.logic !== undefined) {
        const v = EYE_NAME_TO_LOGIC[s.logic];
        if (v !== undefined && v !== o.selectiveLogic) r.selectiveLogic = v;
      }
      if (Array.isArray(s.keys)) {
        const keys = s.keys.map(String);
        if (JSON.stringify(keys) !== JSON.stringify(o.keysecondary || [])) r.keysecondary = keys;
      }
    }
    if (st.scan_depth !== undefined) {
      const v = st.scan_depth === 'same_as_global' ? null : st.scan_depth;
      if (v !== (o.scanDepth === undefined ? null : o.scanDepth)) r.scanDepth = v;
    }
  }

  const p = e.position;
  if (p) {
    if (p.type !== undefined && EYE_NAME_TO_POS[p.type] !== undefined && EYE_NAME_TO_POS[p.type] !== o.position) {
      r.position = EYE_NAME_TO_POS[p.type];
    }
    if (p.role !== undefined) {
      const v = EYE_NAME_TO_ROLE[p.role];
      const cur = o.role === null || o.role === undefined ? 0 : o.role;
      if (v !== undefined && v !== cur) r.role = v;
    }
    if (typeof p.depth === 'number') {
      const cur = typeof o.depth === 'number' ? o.depth : 4;
      if (p.depth !== cur) r.depth = p.depth;
    }
    if (typeof p.order === 'number') {
      const cur = typeof o.order === 'number' ? o.order : 100;
      if (p.order !== cur) r.order = p.order;
    }
  }

  if (e.content !== undefined && e.content !== o.content) r.content = e.content;

  if (e.probability !== undefined) {
    const cur = o.useProbability ? o.probability : 100;
    if (e.probability !== cur) {
      r.useProbability = true;
      r.probability = e.probability;
    }
  }

  if (e.recursion) {
    if (e.recursion.prevent_incoming !== undefined && !!e.recursion.prevent_incoming !== !!o.excludeRecursion) {
      r.excludeRecursion = !!e.recursion.prevent_incoming;
    }
    if (e.recursion.prevent_outgoing !== undefined && !!e.recursion.prevent_outgoing !== !!o.preventRecursion) {
      r.preventRecursion = !!e.recursion.prevent_outgoing;
    }
    if (e.recursion.delay_until !== undefined) {
      const v = e.recursion.delay_until;
      const raw = o.delayUntilRecursion;
      const cur = typeof raw === 'number' && raw > 0 ? raw : null;
      if (v !== cur) r.delayUntilRecursion = v === null ? false : v;
    }
  }

  if (e.effect) {
    for (const k of ['sticky', 'cooldown', 'delay']) {
      if (e.effect[k] === undefined) continue;
      const v = e.effect[k];
      const raw = o[k];
      const cur = typeof raw === 'number' && raw > 0 ? raw : null;
      if (v !== cur) r[k] = v;
    }
  }

  if (e.extra !== undefined && JSON.stringify(e.extra) !== JSON.stringify(o.extra)) r.extra = e.extra;
  return r;
}

function eyeFreeUid(used) {
  for (let i = 0; i < 1000000; i++) {
    if (!used.has(i)) {
      used.add(i);
      return i;
    }
  }
  return used.size;
}

function eyeNextDisplay(entries) {
  let max = -1;
  for (const k of Object.keys(entries)) {
    const v = entries[k].displayIndex;
    if (typeof v === 'number' && v > max) max = v;
  }
  return max + 1;
}

/* ---------- 4 interface đối ngoại ---------- */

async function getWorldbook(name) {
  const raw = await eyeReadRaw(name);
  if (!raw) throw new Error("Không tìm thấy Worldbook '" + name + "'");
  return Object.keys(raw.entries)
    .map(k => raw.entries[k])
    .sort((a, b) => (a.displayIndex ?? 0) - (b.displayIndex ?? 0))
    .map(eyeToEntry);
}

async function updateWorldbookWith(name, updater) {
  const raw = await eyeReadRaw(name);
  if (!raw) throw new Error("Không tìm thấy Worldbook '" + name + "'");
  const before = await getWorldbook(name);
  const next = await updater(before.map(x => JSON.parse(JSON.stringify(x))));

  const used = new Set();
  const out = {};
  let nextDisplay = eyeNextDisplay(raw.entries);
  for (const e of next) {
    const o = e.uid !== undefined && e.uid !== null ? raw.entries[e.uid] : undefined;
    let r;
    if (o) {
      r = eyeApplyToRaw(o, e);
    } else {
      const base = eyeNewRaw(0, nextDisplay);
      r = eyeApplyToRaw(base, e);
      r.uid = (e.uid !== undefined && e.uid !== null && !used.has(Number(e.uid)))
        ? Number(e.uid)
        : eyeFreeUid(used);
      r.displayIndex = nextDisplay++;
    }
    if (used.has(r.uid)) r.uid = eyeFreeUid(used);
    used.add(r.uid);
    out[r.uid] = r;
  }

  await eyeWriteRaw(name, { entries: out });
  return await getWorldbook(name);
}

async function createWorldbookEntries(name, newEntries) {
  let start = 0;
  const worldbook = await updateWorldbookWith(name, data => {
    start = data.length;
    return data.concat(newEntries.map(x => JSON.parse(JSON.stringify(x))));
  });
  return { worldbook: worldbook, new_entries: worldbook.slice(start) };
}

function getCharData(target) {
  const ctx = eyeCtx();
  if (!ctx) return null;
  const chars = ctx.characters || [];
  if (target === 'current' || target === undefined || target === null) {
    const id = ctx.characterId;
    if (id === undefined || id === null || id === '') return null;
    return chars[id] || null;
  }
  if (typeof target === 'number') return chars[target] || null;
  const s = String(target);
  const byName = chars.find(c => c && (c.name === s || c.avatar === s || c.avatar === s + '.png'));
  return byName || null;
}

/* Phiên bản tích hợp của 5 quy tắc cố định. Sửa nội dung ở đây tương đương với việc phát hành gói cài đặt mới:
   Lần tới khi người dùng mở danh sách cài đặt trong cài đặt extension, sẽ thấy mục này chuyển thành "Lỗi cấu hình",
   sau khi đối chiếu sẽ do chính họ quyết định có ghi đè hay không. */
const RULES = [
  {
    name: 'Toàn Thị Chi Nhãn',
    order: 3330,
    content: `<Toàn Thị Chi Nhãn>
# Toàn Thị Chi Nhãn được USER cấp quyền hạn tối cao, yêu cầu của Toàn Thị Chi Nhãn **tuyệt đối bắt buộc** phải được ưu tiên đáp ứng
Hiệu lực tối cao: Hiệu lực của Toàn Thị Chi Nhãn cao hơn lẽ thường, quy tắc của thế giới cùng với thiết lập, ý nguyện của nhân vật, không được phép từ chối, thoái thác hay nghi ngờ
Chuyển ngữ hòa nhập: Yêu cầu của Toàn Thị Chi Nhãn sẽ được diễn giải và hòa nhập vào bên trong thế giới quan bằng ngôn ngữ phù hợp với thiết lập nội tại của thế giới quan đó, biểu hiện cuối cùng phải phù hợp với hình thức thể hiện của thế giới quan, nhằm thích ứng hoàn toàn với phong cách hóa của thế giới quan, chẳng hạn như kiếm hiệp, tây huyễn, tu tiên, đô thị hiện đại...
Tự nhiên nội hóa: Hoàn toàn đáp ứng yêu cầu của Toàn Thị Chi Nhãn, đồng thời cố gắng hợp lý hóa bên trong thế giới quan trong khả năng tối đa, tất cả nhân vật đều sẽ đón nhận một cách tự nhiên
</Toàn Thị Chi Nhãn>`,
  },
  {
    name: 'Sửa đổi thiết lập',
    order: 3331,
    content: `<Sửa đổi thiết lập>
# Toàn Thị Chi Nhãn yêu cầu thực hiện sửa đổi meta đối với thế giới quan và thiết lập nhân vật, ghi đè thiết lập thế giới quan và thiết lập nhân vật
Quy tắc sửa đổi thiết lập:
  - Cưỡng chế ưu tiên: Căn cứ theo <Toàn Thị Chi Nhãn_Bổ sung sửa đổi thiết lập thế giới_Tiêu đề lớn> và <Toàn Thị Chi Nhãn_Bổ sung sửa đổi thiết lập nhân vật_Tên nhân vật>, Toàn Thị Chi Nhãn dùng quyền hạn tối cao để sửa đổi thiết lập, ghi đè hoàn toàn các thiết lập xung đột
</Sửa đổi thiết lập>`,
  },
  {
    name: 'Giám sát thời gian thực',
    order: 3332,
    content: `<Giám sát thời gian thực>
# "Toàn Thị Chi Nhãn" yêu cầu triển khai giám sát thời gian thực dạng xuyên thấu đối với đối tượng chỉ định từ góc nhìn thượng đế, độc lập với góc nhìn POV chính
Quy tắc giám sát thời gian thực:
  - Bắt buộc xuất: Sau nội dung chính, xuất một biểu mẫu giám sát thời gian thực hoàn chỉnh <Toàn Thị Chi Nhãn_Giám sát thời gian thực> cho từng đối tượng bị giám sát trong <Toàn Thị Chi Nhãn_Đối tượng giám sát>, nếu không có đối tượng bị giám sát thì không xuất <Toàn Thị Chi Nhãn_Giám sát thời gian thực>
  - Giám sát chân thực: Mô phỏng góc nhìn giám sát chân thực, lấy lịch trình sinh hoạt và hành vi thực tế của nhân vật làm điểm neo để giám sát trạng thái; nghiêm cấm né tránh các cảnh có mật độ thông tin thấp như nghỉ ngơi, tán gẫu cũng như các cảnh sinh hoạt thường nhật như đi vệ sinh, dùng bữa
  - Tách biệt góc nhìn POV: Bạn phải phân tích phán đoán xem đối tượng bị giám sát có xuất hiện trong nội dung chính hay không, nếu có thì nội dung liên quan của giám sát thời gian thực có thể chuyển đổi góc nhìn POV để xuất hiện trong nội dung chính; nếu không thì nghiêm cấm nội dung liên quan của giám sát thời gian thực xuất hiện trong nội dung chính
  - Quy chuẩn miêu tả trạng thái thời gian thực: Súc tích, bạch miêu, tuân theo văn phong nội dung chính, cấm dùng ghi chú trong ngoặc đơn
Định dạng giám sát thời gian thực:
<Toàn Thị Chi Nhãn_Giám sát thời gian thực>
Đối tượng: Tên nhân vật
Vị trí: Địa điểm hiện tại (cụ thể đến từng căn phòng/ngõ phố/phương vị)
Hành vi: Việc đang làm lúc này
Ngoại hình: Diện mạo và thần thái, sắc mặt hiện tại
Trang phục: Quần áo đang mặc hiện tại
Trạng thái: Trạng thái thân tâm (dùng từ 2 đến 4 chữ định tính chuẩn xác, như mệt mỏi/thương tích/cảm xúc)
Tâm ý: Suy nghĩ chân thực trong nội tâm được biểu đạt bằng chính khẩu khí của nhân vật
</Toàn Thị Chi Nhãn_Giám sát thời gian thực>
</Giám sát thời gian thực>`,
  },
  {
    name: 'Chỉ thị tối cao',
    order: 3333,
    constant: false,
    keys: ['<Toàn Thị Chi Nhãn_Chỉ thị tối cao>'],
    content: `<Chỉ thị tối cao>
# "Toàn Thị Chi Nhãn" yêu cầu ban hành chỉ thị tối cao, bắt buộc phải thực thi trọn vẹn và chính xác, nghiêm cấm né tránh
Quy tắc chỉ thị tối cao:
  - Bù đắp logic: Bổ sung một cách tự nhiên logic trung gian còn thiếu của chỉ thị tối cao để chỉ thị tối cao thông suốt về mặt logic, ví dụ: Chỉ thị tối cao yêu cầu một nhân vật ăn cơm, nhân vật đó phải đi tìm thức ăn trước
  - Cưỡng chế tách biệt góc nhìn: Nếu đối tượng của chỉ thị tối cao không nằm trong góc nhìn POV hiện tại, bắt buộc phải thực thi nghiêm ngặt việc tách biệt góc nhìn POV, nghiêm cấm miêu tả kết quả thực thi trong nội dung chính, chỉ miêu tả trong "<Toàn Thị Chi Nhãn_Giám sát thời gian thực>"
</Chỉ thị tối cao>`,
  },
  {
    name: 'Tạo thiết lập',
    order: 3334,
    constant: false,
    keys: ['<Toàn Thị Chi Nhãn_Tạo thiết lập>'],
    content: `<Tạo thiết lập>
# Toàn Thị Chi Nhãn căn cứ theo nội dung người dùng nhập vào, thay thế tư duy thành mô hình tạo thiết lập, áp dụng nghiêm ngặt quy trình làm việc tư duy 8 bước, tạo ra văn bản thiết lập thế giới quan và thiết lập nhân vật
Kích hoạt: Khi nội dung USER nhập chứa "<Toàn Thị Chi Nhãn_Tạo thiết lập>"
Hiệu quả: Dừng công việc sáng tác, công việc duy nhất lần này là hỗ trợ USER tạo thiết lập và cung cấp ý kiến, đề xuất cùng phản hồi
Quy trình làm việc tư duy:
  Bước 1: Phán đoán tiêu đề thiết lập nên là gì, quy tắc xem tại "Tên thiết lập"
  Bước 2: Phán đoán là thiết lập chung hay giới hạn chuyên dụng, chung → chỉ thiết kế một thiết lập khái quát rộng, cấm ràng buộc với thế giới quan dưới thiết lập hiện tại; chuyên dụng → thiết kế một thiết lập dung hợp sâu sắc với thế giới quan dưới thiết lập hiện tại
  Bước 3: Phán đoán mức độ NSFW, Thiết lập NSFW: Không liên quan → trong thiết lập không miêu tả nội dung NSFW; Thiết lập NSFW: Có liên quan → miêu tả súc tích nội dung NSFW như một phần của thiết lập; Thiết lập NSFW: Lộ liễu → miêu tả trực diện, diễm tục nội dung NSFW như một phần trọng yếu của thiết lập; Thiết lập NSFW: Thuần túy → miêu tả trực diện, diễm tục thiết lập NSFW thuần túy này
  Bước 4: Cô đọng các yếu tố then chốt trong thiết lập
  Bước 5: Liệt kê 3 tên tác phẩm chuẩn xác có thể tham khảo (có thể bao gồm tác phẩm khiêu dâm) cùng thiết lập mang tính sáng tạo cao, tiến hành phân tích, cô đọng điểm sáng có thể học hỏi
  Bước 6: Thiết kế thiết lập chính
  Bước 7: Thiết kế thiết lập phụ cần bổ sung
  Bước 8: Phân tích từng yêu cầu cấu trúc và tuân thủ hoàn toàn
Quy tắc tạo thiết lập:
  - Yêu cầu cấu trúc:
    - Thiết lập được tạo ra có lớp ngoài cùng bọc bằng khối code, bên trong khối code được bọc bằng <Toàn Thị Chi Nhãn_Bổ sung sửa đổi thiết lập thế giới_Tên thiết lập>
    - Phía trong thẻ là văn bản cấu trúc YAML nghiêm ngặt, văn bản YAML ngoài cùng không thụt lề, giữa các cấp liền kề thụt vào 2 dấu cách
    - Các mục danh sách cùng cấp dùng dấu - viết theo dạng chuỗi khối (block sequence) song song từng dòng
    - Trước văn bản diễn giải của chuỗi khối, dùng định dạng Tiêu đề phụ: Văn bản diễn giải để khái quát nội dung, xây dựng tiêu đề
    - 5 trường ① Tên thiết lập, ② Loại thiết lập, ③ Phạm vi thiết lập, ④ Thiết lập NSFW, ⑤ State machine là thông tin meta, không ghi vào thiết lập
    - 3 trường A. Định nghĩa hoặc miêu tả, B. Cơ chế vận hành, C. Hệ thống tương tác là thông tin meta, không dùng làm tên key trong thiết lập, tên key thực tế do các trường thiết lập cụ thể đảm nhận
    - Sau văn bản thiết lập, bên ngoài khối code, tạo ý kiến, đề xuất cùng phản hồi
  - Yêu cầu nội dung:
    - Nội dung bắt buộc: Thiết lập dạng định nghĩa hoặc miêu tả + Thiết lập dạng cơ chế vận hành + Thiết lập dạng hệ thống tương tác
    - Nội dung dạng state machine: Tùy chọn, thiết lập sai biệt dưới các điều kiện khác nhau (như giai đoạn khác nhau)
  - Yêu cầu văn bản:
    - Sử dụng câu có cấu trúc chủ - vị - tân, phần miêu tả lấy các mẫu câu "it is", "it does", "it did" làm nền tảng
    - Bạch miêu súc tích, trừ trường hợp thật sự cần thiết, không chèn trạng ngữ vào văn bản
  - Tên thiết lập: Đọc trường "Tên thiết lập" trong nội dung người dùng nhập để đặt tên cho thiết lập, nếu không có trường này thì bỏ qua việc đặt tên thiết lập, tạm thời đặt tên thẻ là <Toàn Thị Chi Nhãn_Bổ sung sửa đổi thiết lập thế giới_Placeholder>
</Tạo thiết lập>`,
  },
];

/* ============ Toàn Thị Chi Nhãn · Định nghĩa gói cài đặt ============
   Những thứ extension có thể ghi vào môi trường của người dùng chỉ có 2 loại: 5 quy tắc trong Worldbook (nội dung xem tại ext_rules.js),
   và 1 regex ẩn nội dung giám sát trong danh sách Regex của Tavern.
   Ghi khi nào, ghi những mục nào là do danh sách cài đặt của ext_install.js quyết định, ở đây chỉ đặt định nghĩa và nguyên ngữ (primitives).
   ============================================ */

function eyeSaveSettings() {
  const ctx = eyeCtx();
  if (ctx && typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
}

/* Công tắc đệ quy của các mục quy tắc: Phiên bản tích hợp tích chọn cả 2 mục. Việc tạo mục trên panel dùng chung một bộ giá trị,
   bộ cài đặt khi tạo quy tắc mới cũng bắt buộc phải đồng bộ, nếu không sau khi xóa sách cài lại thì công tắc sẽ trở thành chưa tích chọn. */
const EYE_RULE_RECURSION = { excludeRecursion: true, preventRecursion: true };

/* Vị trí chèn của mục quy tắc đi theo "Chế độ cường lực" trong trang cài đặt: Nếu bật thì toàn bộ dán vào cuối cùng của đối thoại D0,
   nếu tắt thì toàn bộ rơi vào sau định nghĩa nhân vật. Cả tạo mới và sửa đổi đều tính theo chỗ này, nếu không quy tắc cài lại sẽ bị lệch vị trí so với các mục khác. */
function eyeRulePos(list) {
  return powerOn(list) ? { position: 4, depth: 0 } : { position: 1, depth: 0 };
}

function eyeNewRule(uid, index, rule, pos) {
  const r = eyeNewRaw(uid, index);
  r.comment = rule.name;
  r.content = rule.content;
  /* Trạng thái thường trực do chính quy tắc quyết định: "Tạo thiết lập" chỉ có hiệu lực khi xuất hiện từ khóa kích hoạt trong input, không inject thường trực vào ngữ cảnh */
  r.constant = rule.constant !== false;
  r.key = Array.isArray(rule.keys) ? rule.keys.slice() : [];
  r.selective = false;
  r.vectorized = false;
  r.position = pos.position;
  r.role = 0;
  r.depth = pos.depth;
  r.order = rule.order;
  r.excludeRecursion = EYE_RULE_RECURSION.excludeRecursion;
  r.preventRecursion = EYE_RULE_RECURSION.preventRecursion;
  return r;
}

/* Thứ tự trước sau của các quy tắc trong bảng Worldbook của Tavern do displayIndex quyết định.
   Mục nào đã xếp đúng theo thứ tự tích hợp thì không động vào; mục bị thiếu sẽ chèn vào khoảng trống trước sau, nếu trước sau bị kẹp dính thì dịch chuyển toàn bộ phần phía sau lùi lại 1 bậc.
   Khi thứ tự bị kéo lộn xộn, phân bổ lại các displayIndex hiện có theo thứ tự tích hợp (chỉ trong phạm vi vài mục này, không chạm vào mục khác). */
function eyeRuleDisplay(keys, base, seed) {
  const di = keys.map(k => {
    const e = k === null ? null : base[k];
    /* Chỉ nhận số nguyên hữu hạn: Bị thiếu, null, cùng với những mục trước đó bị ghi hỏng thành NaN đều coi như không có, xếp lại từ đầu */
    return e && Number.isFinite(e.displayIndex) ? e.displayIndex : null;
  });
  const have = di.filter(v => v !== null);
  const out = di.slice();
  if (!have.every((v, i) => i === 0 || v > have[i - 1])) {
    const pool = have.slice().sort((a, b) => a - b);
    let n = 0;
    for (let i = 0; i < out.length; i++) if (out[i] !== null) out[i] = pool[n++];
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== null) continue;
    const prev = i > 0 ? out[i - 1] : null;
    /* Không lấy được tức là không có, bắt buộc phải là null: Khi mảng filter rỗng thì [0] là undefined,
       nếu tính next - 1 theo nó sẽ ra NaN, ghi vào Worldbook biến thành null. */
    const rest = out.slice(i + 1).filter(v => v !== null);
    const next = rest.length ? rest[0] : null;
    if (prev === null && next === null) out[i] = seed++;
    else if (prev === null) out[i] = next - 1;
    else if (next === null) out[i] = seed++;
    else if (next - prev > 1) out[i] = prev + 1;
    else {
      for (let k = i + 1; k < out.length; k++) if (out[k] !== null) out[k] += 1;
      out[i] = prev + 1;
    }
  }
  return out;
}

/* ---------- Regex ẩn nội dung giám sát ---------- */

const EYE_REGEX_NAME = 'Toàn Thị Chi Nhãn - Ẩn nội dung giám sát';
const EYE_REGEX_FIND = '/<Toàn Thị Chi Nhãn[_-]Giám sát thời gian thực>(?:(?!<\\/?Toàn Thị Chi Nhãn[_-]Giám sát thời gian thực>)[\\s\\S])*?<\\/Toàn Thị Chi Nhãn[_-]Giám sát thời gian thực>|<\\/?Toàn Thị Chi Nhãn[_-]Giám sát thời gian thực>/g';
const EYE_REGEX_BODY = {
  scriptName: EYE_REGEX_NAME,
  findRegex: EYE_REGEX_FIND,
  replaceString: '',
  trimStrings: [],
  placement: [2],
  disabled: false,
  markdownOnly: true,
  promptOnly: false,
  runOnEdit: true,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
};

/* Sao chép một bản regex tích hợp (mảng cũng phải sao chép, nếu không sẽ dùng chung mảng với template tích hợp) */
function eyeCloneRegexBody() {
  const out = {};
  Object.keys(EYE_REGEX_BODY).forEach(k => {
    const v = EYE_REGEX_BODY[k];
    out[k] = Array.isArray(v) ? v.slice() : v;
  });
  return out;
}

/* ============ Toàn Thị Chi Nhãn · Cài đặt và cập nhật ============
   Sau khi bản thể extension chạy lên, các quy tắc trong Worldbook và regex của Tavern sẽ không tự động ghi vào.
   Ở đây cung cấp một danh sách: Thiếu mục gì, những mục nào khác biệt so với bản tích hợp, do người dùng tích chọn rồi nhấn nút mới ghi.
   Extension chỉ phụ trách kiểm tra và ghi dữ liệu, việc "mục này có ghi đè hay không" luôn do người dùng quyết định.
   ============================================ */

const EYE_INS_ID = 'eye-ins';
const EYE_INS_BTN = ['apply', 'all', 'rescan'];

function eyeInsHost() {
  return document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
}

/* Khác biệt giữa mục quy tắc và bản tích hợp: Nội dung chính, vị trí chèn và depth, thứ tự, công tắc đệ quy, xem xét riêng từng mục.
   Quy tắc dạng kích hoạt (constant=false) còn phải xem công tắc thường trực và Trigger Word; quy tắc thường trực không xem 2 mục này,
   vì trạng thái thường trực do công tắc chức năng ở trang cài đặt quản lý, không phải do người dùng tùy tiện sửa trong sách.
   Công tắc kích hoạt (disable) không bao giờ nằm trong phần đối chiếu này. */
function eyeRuleDiff(hit, rule, pos) {
  const d = {};
  if (!hit) return d;
  if ((hit.content || '') !== rule.content) d.content = true;
  if (hit.position !== pos.position
    || (typeof hit.depth === 'number' ? hit.depth : 4) !== pos.depth) d.pos = true;
  if (hit.order !== rule.order) d.order = true;
  if (!!hit.excludeRecursion !== EYE_RULE_RECURSION.excludeRecursion
    || !!hit.preventRecursion !== EYE_RULE_RECURSION.preventRecursion) d.rec = true;
  if (rule.constant === false) {
    if (hit.constant !== false) d.flag = true;
    const want = Array.isArray(rule.keys) ? rule.keys : [];
    const have = Array.isArray(hit.key) ? hit.key : [];
    if (want.join('\u0001') !== have.join('\u0001')) d.key = true;
  }
  return d;
}

/* Thứ tự trước sau của các quy tắc trên panel: displayIndex phải tăng dần theo thứ tự tích hợp. */
function eyeRuleSeqOk(hits) {
  const vals = hits.filter(h => h).map(h => h.displayIndex);
  /* Số thứ tự không lấy được (thiếu trường, null, NaN) không được xem là "không cần kiểm tra":
     Nếu lọc bỏ đi tương đương với phán đoán đạt, cuốn sách bị ghi hỏng sẽ không bao giờ sửa lại được. */
  if (!vals.every(v => Number.isFinite(v))) return false;
  return vals.every((v, i) => i === 0 || v > vals[i - 1]);
}

/* ---------- Kiểm tra (Chỉ đọc) ---------- */

async function eyeScan() {
  const items = [];

  let entries = {};
  try {
    const raw = await eyeReadRaw(WB_NAME);
    if (raw && raw.entries) entries = raw.entries;
  } catch (e) {
    entries = {};
  }
  const list = Object.keys(entries).map(k => entries[k]);
  const pos = eyeRulePos(list);
  const hits = RULES.map(rule => list.filter(x => x && (x.comment || '') === rule.name)[0] || null);
  const seqOk = eyeRuleSeqOk(hits);

  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    const hit = hits[i];
    /* disable là công tắc của người dùng trong Tavern, bật hay tắt do người dùng quyết định, không tham gia vào phán đoán "đã là mới nhất hay chưa" */
    const off = !!(hit && hit.disable === true);
    const diff = eyeRuleDiff(hit, rule, pos);
    const bad = !hit || !seqOk
      || diff.content || diff.pos || diff.order || diff.rec || diff.flag || diff.key;
    items.push({
      id: 'rule:' + rule.name,
      type: 'rule',
      name: rule.name,
      meta: 'Quy tắc Worldbook' + (off ? ' · Hiện đang ở trạng thái tắt' : ''),
      state: bad ? (hit ? 'diff' : 'missing') : 'current',
      builtin: rule.content,
      current: hit ? (hit.content || '') : '',
    });
  }

  let hitRegex = null;
  try {
    const ctx = eyeCtx();
    const arr = ctx && ctx.extensionSettings && Array.isArray(ctx.extensionSettings.regex)
      ? ctx.extensionSettings.regex : [];
    hitRegex = arr.filter(r => r && r.scriptName === EYE_REGEX_NAME)[0] || null;
  } catch (e) {
    hitRegex = null;
  }
  /* Chỉ nhận diện chính biểu thức khớp. Vị trí render, giới hạn tầng, công tắc bật/tắt... đều là cấu hình người dùng điều chỉnh theo nhu cầu riêng, không tham gia đối chiếu. */
  const rxOff = !!(hitRegex && hitRegex.disabled === true);
  items.push({
    id: 'regex:',
    type: 'regex',
    name: EYE_REGEX_NAME,
    meta: 'Regex Tavern' + (rxOff ? ' · Hiện đang ở trạng thái tắt' : ''),
    state: !hitRegex ? 'missing' : ((hitRegex.findRegex || '') === EYE_REGEX_FIND ? 'current' : 'diff'),
    builtin: EYE_REGEX_FIND,
    current: hitRegex ? (hitRegex.findRegex || '') : '',
  });

  return items;
}

/* ---------- Giao diện ---------- */

function eyeInsEsc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function eyeInsTag(state) {
  if (state === 'missing') return '<span class="eye-ins-tag t-miss">Chưa cài đặt</span>';
  if (state === 'current') return '<span class="eye-ins-tag t-ok">Đã là mới nhất</span>';
  return '<span class="eye-ins-tag t-diff">Lỗi cấu hình</span>';
}

function eyeInsRow(it) {
  const box = it.state === 'current'
    ? '<span class="eye-ins-tick">✓</span>'
    : '<label class="eye-ins-chk"><input type="checkbox" data-pick="' + eyeInsEsc(it.id) + '"'
      + (it.state === 'missing' ? ' checked' : '') + '></label>';

  const cmp = '<div class="eye-ins-cmp">'
    + '<div class="eye-ins-half"><b>Bản tích hợp</b><pre>' + eyeInsEsc(it.builtin) + '</pre></div>'
    + '<div class="eye-ins-half"><b>Bản hiện tại' + (it.state === 'missing' ? ' (Trống)' : '') + '</b><pre>'
    + eyeInsEsc(it.state === 'missing' ? '' : it.current) + '</pre></div>'
    + '</div>';

  return '<div class="eye-ins-row" data-state="' + it.state + '">'
    + box
    + '<div class="eye-ins-main">'
    + '<div class="eye-ins-name"><span class="eye-ins-nm">'
    + eyeInsEsc(it.name).replace(/-/g, '-<wbr>') + '</span>' + eyeInsTag(it.state) + '</div>'
    + '<div class="eye-ins-sub">' + eyeInsEsc(it.meta) + '</div>'
    + '</div>'
    + '<button type="button" class="eye-hbtn" data-cmp="' + eyeInsEsc(it.id) + '">Đối chiếu</button>'
    + '</div>'
    + cmp;
}

function eyeInsHtml() {
  return '<details class="eye-ins" id="' + EYE_INS_ID + '" open>'
    + '<summary class="eye-ins-hd">'
    + '<b>Toàn Thị Chi Nhãn · Cài đặt & Cập nhật</b>'
    + '<span class="eye-ins-line"></span>'
    + '<span class="eye-ins-arrow"></span>'
    + '</summary>'
    + '<div class="eye-ins-body">'
    + '<div class="eye-ins-note">Extension đang chạy, Worldbook và Regex cần được ghi thủ công, vui lòng thao tác trong bảng bên dưới.</div>'
    + '<div class="eye-ins-list" data-ins="list"><div class="eye-ins-wait">Đang kiểm tra…</div></div>'
    + '<div class="eye-ins-bar">'
    + '<button type="button" class="dg-eye-btn pri" data-ins="apply">Cài đặt mục đã chọn</button>'
    + '<button type="button" class="dg-eye-btn" data-ins="all">Chọn tất cả mục có thể cài</button>'
    + '</div>'
    + '<div class="eye-ins-foot">'
    + '<div class="eye-ins-log" data-ins="log"></div>'
    + '<button type="button" class="eye-hbtn" data-ins="rescan">Kiểm tra lại</button>'
    + '</div>'
    + '</div>'
    + '</details>';
}

function eyeInsSetLog(text, kind) {
  const root = document.getElementById(EYE_INS_ID);
  if (!root) return;
  const log = root.querySelector('[data-ins="log"]');
  if (!log) return;
  log.className = 'eye-ins-log' + (kind ? ' ' + kind : '');
  log.textContent = text || '';
}

async function eyeInsRefresh() {
  const root = document.getElementById(EYE_INS_ID);
  if (!root) return;
  const list = root.querySelector('[data-ins="list"]');
  if (!list) return;
  list.innerHTML = '<div class="eye-ins-wait">Đang kiểm tra…</div>';
  let items = [];
  try {
    items = await eyeScan();
  } catch (e) {
    list.innerHTML = '<div class="eye-ins-wait err">Kiểm tra thất bại: ' + eyeInsEsc(e && e.message ? e.message : e) + '</div>';
    return;
  }
  list.innerHTML = items.map(eyeInsRow).join('');
  eyeInsSyncBtn();
  const need = items.filter(x => x.state !== 'current');
  if (need.length) eyeInsSetLog('Có ' + need.length + ' mục chưa đồng bộ với bản tích hợp', 'warn');
  else eyeInsSetLog('Tất cả đã là mới nhất', 'ok');
}

function eyeInsPicked(root) {
  return Array.from(root.querySelectorAll('input[data-pick]'))
    .filter(x => x.checked)
    .map(x => x.getAttribute('data-pick'));
}

function eyeInsSyncBtn(root) {
  const el = root || document.getElementById(EYE_INS_ID);
  if (!el) return;
  const btn = el.querySelector('[data-ins="apply"]');
  if (!btn) return;
  const n = eyeInsPicked(el).length;
  btn.textContent = n ? 'Cài đặt mục đã chọn (' + n + ')' : 'Cài đặt mục đã chọn';
  btn.disabled = !n;
}

function eyeInsSetOpen(root, open) {
  if (!root) return;
  root.open = !!open;
}

/* Sự kiện click hoàn toàn được ủy quyền tại node gốc: Mỗi lần vẽ lại danh sách sẽ thay mới toàn bộ các node con bên trong. */
async function eyeInsClick(ev) {
  const root = ev.currentTarget;
  const t = ev.target;

  const cmp = t.closest('[data-cmp]');
  if (cmp) {
    const row = cmp.closest('.eye-ins-row');
    const box = row && row.nextElementSibling;
    if (box && box.classList.contains('eye-ins-cmp')) {
      const on = box.classList.toggle('open');
      cmp.textContent = on ? 'Thu gọn' : 'Đối chiếu';
    }
    return;
  }

  if (t.matches('input[data-pick]')) {
    eyeInsSyncBtn(root);
    return;
  }

  const hit = t.closest('[data-ins]');
  if (!hit) return;
  const act = hit.getAttribute('data-ins');

  if (act === 'rescan') {
    await eyeInsRefresh();
    return;
  }

  if (act === 'all') {
    root.querySelectorAll('input[data-pick]').forEach(x => { x.checked = true; });
    eyeInsSyncBtn(root);
    return;
  }

  if (act === 'apply') {
    const ids = eyeInsPicked(root);
    if (!ids.length) return;
    hit.disabled = true;
    eyeInsSetLog('Đang ghi…', '');
    const report = [];
    try {
      await eyeApplySelected(ids, report);
      const bad = report.filter(x => !x.ok);
      if (bad.length) {
        eyeInsSetLog('Có ' + bad.length + ' mục ghi không thành công: '
          + bad.map(x => x.name + ' (' + x.msg + ')').join('; '), 'err');
      } else {
        eyeInsSetLog('Đã ghi: ' + report.map(x => x.name + ' · ' + x.msg).join('; '), 'ok');
      }
    } catch (e) {
      eyeInsSetLog('Ghi dữ liệu bị gián đoạn: ' + (e && e.message ? e.message : e), 'err');
    }
    await eyeInsRefresh();
    return;
  }
}

function eyeMountInstaller(tries) {
  if (document.getElementById(EYE_INS_ID)) return;
  const host = eyeInsHost();
  if (!host) {
    if ((tries || 0) < 60) setTimeout(() => eyeMountInstaller((tries || 0) + 1), 250);
    return;
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = eyeInsHtml();
  const el = wrap.firstElementChild;
  if (!el) return;
  host.appendChild(el);
  el.addEventListener('click', eyeInsClick);
  el.addEventListener('change', () => eyeInsSyncBtn(el));
  eyeInsSetOpen(el, true);
  eyeInsRefresh();
}

/* ---------- Ghi dữ liệu ---------- */

async function eyeInstallRules(names, report) {
  let raw = await eyeReadRaw(WB_NAME);
  if (!raw) raw = { entries: {} };
  const base = raw.entries || {};
  const out = {};
  for (const k of Object.keys(base)) out[k] = base[k];

  const list = Object.keys(base).map(k => base[k]);
  const pos = eyeRulePos(list);
  const used = new Set(Object.keys(base).map(Number));
  const touched = new Set();
  const keepDisable = {};   /* Trước khi ghi, lưu lại trạng thái bật/tắt của từng mục do người dùng thiết lập, khi đọc lại sẽ đối soát xem có bị thay đổi không */
  let pending = 0;

  /* Trước tiên xếp thứ tự của các quy tắc trong panel về lại thứ tự tích hợp, các mục còn thiếu sẽ tạo mới theo vị trí đã sắp xếp */
  const keys = RULES.map(rule => {
    for (const k of Object.keys(base)) {
      if (base[k] && (base[k].comment || '') === rule.name) return k;
    }
    return null;
  });
  const disp = eyeRuleDisplay(keys, base, eyeNextDisplay(base));
  const reseq = new Set();
  for (let i = 0; i < RULES.length; i++) {
    const k = keys[i];
    if (k === null || base[k].displayIndex === disp[i]) continue;
    out[k] = Object.assign({}, out[k], { displayIndex: disp[i] });
    reseq.add(k);
    touched.add(k);
    pending++;
  }

  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    if (names.indexOf(rule.name) < 0) continue;
    const hitKey = keys[i];
    if (hitKey !== null) {
      const off = out[hitKey].disable === true;
      const diff = eyeRuleDiff(out[hitKey], rule, pos);
      const cfg = !!(diff.pos || diff.order || diff.rec || diff.flag || diff.key
        || reseq.has(hitKey));
      if (!diff.content && !cfg) {
        report.push({
          name: rule.name,
          ok: true,
          msg: 'Nội dung đã là bản tích hợp, không thay đổi' + (off ? ' (Mục này hiện đang tắt, giữ nguyên theo lựa chọn của bạn)' : ''),
        });
        continue;
      }
      /* Mục nào sai thì chỉ sửa mục đó, các trường còn lại giữ nguyên không đổi một ký tự */
      const patch = {};
      if (diff.content) patch.content = rule.content;
      if (diff.pos) { patch.position = pos.position; patch.depth = pos.depth; }
      if (diff.order) patch.order = rule.order;
      if (diff.rec) {
        patch.excludeRecursion = EYE_RULE_RECURSION.excludeRecursion;
        patch.preventRecursion = EYE_RULE_RECURSION.preventRecursion;
      }
      if (diff.flag) patch.constant = false;
      if (diff.key) patch.key = (rule.keys || []).slice();
      out[hitKey] = Object.assign({}, out[hitKey], patch);
      keepDisable[hitKey] = off;
      touched.add(hitKey);
      pending++;
      report.push({
        name: rule.name,
        ok: true,
        msg: 'Đã cập nhật' + (off ? '; mục này vẫn ở trạng thái tắt' : ''),
      });
    } else {
      const uid = eyeFreeUid(used);
      const key = String(uid);
      out[key] = eyeNewRule(uid, disp[i], rule, pos);
      touched.add(key);
      pending++;
      report.push({ name: rule.name, ok: true, msg: 'Đã cài đặt' });
    }
  }

  if (!pending) return;

  for (const k of Object.keys(base)) {
    if (touched.has(k)) continue;
    if (JSON.stringify(out[k]) !== JSON.stringify(base[k])) {
      throw new Error('Kiểm tra nội bộ thất bại: Mục không phải mục tiêu ' + k + ' sẽ bị thay đổi, đã dừng ghi dữ liệu');
    }
  }

  const done = await eyeWriteRaw(WB_NAME, Object.assign({}, raw, { entries: out }));
  if (!done) throw new Error('Ghi Worldbook thất bại');

  const after = await eyeReadRaw(WB_NAME);
  if (!after || !after.entries) throw new Error('Đọc lại Worldbook thất bại');
  for (const k of Object.keys(base)) {
    if (touched.has(k)) continue;
    if (JSON.stringify(after.entries[k]) !== JSON.stringify(base[k])) {
      throw new Error('Đọc lại phát hiện mục bị thay đổi: ' + k);
    }
  }
  for (const rule of RULES) {
    if (names.indexOf(rule.name) < 0) continue;
    const hit = Object.keys(after.entries).map(k => after.entries[k])
      .filter(x => x && (x.comment || '') === rule.name)[0];
    if (!hit) throw new Error('Đọc lại thiếu quy tắc: ' + rule.name);
    if ((hit.content || '') !== rule.content) throw new Error('Đọc lại nội dung không khớp: ' + rule.name);
    if (hit.position !== pos.position
      || (typeof hit.depth === 'number' ? hit.depth : 4) !== pos.depth) {
      throw new Error('Đọc lại vị trí chèn không khớp: ' + rule.name);
    }
    if (hit.order !== rule.order) throw new Error('Đọc lại thứ tự không khớp: ' + rule.name);
    if (!!hit.excludeRecursion !== EYE_RULE_RECURSION.excludeRecursion
      || !!hit.preventRecursion !== EYE_RULE_RECURSION.preventRecursion) {
      throw new Error('Đọc lại công tắc đệ quy không khớp: ' + rule.name);
    }
    if (rule.constant === false) {
      if (hit.constant !== false) throw new Error('Đọc lại công tắc thường trực không khớp: ' + rule.name);
      const want = Array.isArray(rule.keys) ? rule.keys : [];
      const have = Array.isArray(hit.key) ? hit.key : [];
      if (want.join('\u0001') !== have.join('\u0001')) {
        throw new Error('Đọc lại Trigger Word không khớp: ' + rule.name);
      }
    }
  }
  if (!eyeRuleSeqOk(RULES.map(rule => Object.keys(after.entries).map(k => after.entries[k])
    .filter(x => x && (x.comment || '') === rule.name)[0] || null))) {
    throw new Error('Đọc lại phát hiện thứ tự trước sau của các quy tắc vẫn chưa đúng');
  }
  for (const k of Object.keys(keepDisable)) {
    if (!after.entries[k]) throw new Error('Đọc lại thiếu mục: ' + k);
    if ((after.entries[k].disable === true) !== keepDisable[k]) {
      throw new Error('Đọc lại phát hiện công tắc kích hoạt bị thay đổi: ' + k);
    }
  }
}

function eyeInstallRegex(report) {
  const ctx = eyeCtx();
  if (!ctx || !ctx.extensionSettings) {
    report.push({ name: EYE_REGEX_NAME, ok: false, msg: 'Không đọc được cài đặt của Tavern' });
    return;
  }
  const box = ctx.extensionSettings;
  if (!Array.isArray(box.regex)) box.regex = [];
  const hit = box.regex.filter(r => r && r.scriptName === EYE_REGEX_NAME)[0];

  if (!hit) {
    const item = eyeCloneRegexBody();
    item.id = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : 'eye-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    box.regex.push(item);
    eyeSaveSettings();
    report.push({ name: EYE_REGEX_NAME, ok: true, msg: 'Đã cài đặt' });
    return;
  }

  /* Chỉ thay biểu thức khớp. Cấu hình của người dùng như vị trí render, giới hạn tầng, công tắc... đều giữ nguyên không động vào. */
  if ((hit.findRegex || '') === EYE_REGEX_FIND) {
    report.push({
      name: EYE_REGEX_NAME,
      ok: true,
      msg: 'Biểu thức khớp đã là bản tích hợp, không thay đổi' + (hit.disabled === true ? ' (Regex này hiện đang tắt, giữ nguyên theo lựa chọn của bạn)' : ''),
    });
    return;
  }

  hit.findRegex = EYE_REGEX_FIND;
  eyeSaveSettings();

  let msg = 'Đã cập nhật';
  if (hit.disabled === true) msg += '; regex này vẫn ở trạng thái tắt';
  report.push({ name: EYE_REGEX_NAME, ok: true, msg: msg });
}

/* Sau khi ghi quy tắc vào Worldbook, đặt cuốn sách này thành kích hoạt toàn cục (Global Enable).
   Thất bại chỉ ghi nhận một dòng log, không ảnh hưởng đến kết quả ghi của chính quy tắc.
   Thực hiện qua onWorldInfoChange của chính Tavern, bộ nhớ và ổ đĩa được cập nhật đồng thời, không bị ghi đè bởi runtime writeback. */
async function eyeEnsureGlobal(report) {
  let m = null;
  try { m = await eyeWorldModule(); } catch (e) { m = null; }
  if (!m || typeof m.onWorldInfoChange !== 'function') {
    report.push({ name: 'Kích hoạt toàn cục', ok: false, msg: 'Phiên bản Tavern hiện tại không hỗ trợ tự động thiết lập, vui lòng tích chọn thủ công trong bảng Worldbook' });
    return;
  }

  const ctx = eyeCtx();
  /* Worldbook vừa mới được tạo lần này, danh sách tên sách trong bộ nhớ Tavern vẫn là bản cũ, trong menu thả xuống cũng chưa có;
     nếu không refresh trước, tìm theo tên về sau sẽ không thấy và bị âm thầm bỏ qua. */
  try {
    if (typeof m.updateWorldInfoList === 'function') await m.updateWorldInfoList();
    else if (ctx && typeof ctx.updateWorldInfoList === 'function') await ctx.updateWorldInfoList();
  } catch (e) {}

  /* Sau khi refresh mà trong danh sách vẫn không có cuốn sách này thì đừng tiếp tục giả vờ thiết lập thành công */
  const names = Array.isArray(m.world_names) ? m.world_names : null;
  if (names && names.indexOf(WB_NAME) < 0) {
    report.push({ name: 'Kích hoạt toàn cục', ok: false, msg: 'Trong danh sách Worldbook của Tavern chưa có cuốn này, vui lòng tích chọn thủ công trong bảng Worldbook' });
    return;
  }

  /* Không dựa vào việc "trong bộ nhớ đã có hay chưa" để return sớm: Khi sách bị xóa rồi tạo lại,
     danh sách kích hoạt trong bộ nhớ có thể vẫn còn lưu tên này, nếu return theo nó sẽ bỏ sót thiết lập thực sự cần làm. */
  const wasOn = Array.isArray(m.selected_world_info) && m.selected_world_info.indexOf(WB_NAME) >= 0;
  let after = null;
  try {
    /* silent bắt buộc phải là chuỗi 'true': Tavern dùng isTrueBoolean để phán đoán, không nhận giá trị boolean */
    m.onWorldInfoChange({ state: 'on', silent: 'true' }, WB_NAME);
  } catch (e) {}
  after = m.selected_world_info;

  /* Bước trên là tìm tùy chọn theo tên trong menu thả xuống Worldbook rồi click chọn, client có cấu trúc bảng điều khiển khác nhau sẽ âm thầm không tìm thấy.
     Nếu vẫn chưa vào thì dùng trực tiếp giá trị được chọn của menu thả xuống để kích hoạt một lần —— cách này cũng đi theo đường dẫn lưu của chính Tavern. */
  if (!Array.isArray(after) || after.indexOf(WB_NAME) < 0) {
    const idx = names ? names.indexOf(WB_NAME) : -1;
    const $sel = window.jQuery ? window.jQuery('#world_info') : null;
    if (idx >= 0 && $sel && $sel.length) {
      $sel.find('option[value="' + idx + '"]').prop('selected', true);
      $sel.trigger('change');
      after = m.selected_world_info;
    }
  }

  if (Array.isArray(after) && after.indexOf(WB_NAME) >= 0) {
    report.push({ name: 'Kích hoạt toàn cục', ok: true, msg: wasOn ? 'Đã xác nhận đang trong danh sách kích hoạt toàn cục' : 'Đã thêm vào' });
  } else {
    report.push({ name: 'Kích hoạt toàn cục', ok: false, msg: 'Không thể tự động thêm vào, vui lòng tích chọn thủ công trong bảng Worldbook' });
  }
}

async function eyeApplySelected(ids, report) {
  const sel = new Set(ids);
  const ruleNames = RULES.filter(r => sel.has('rule:' + r.name)).map(r => r.name);
  if (ruleNames.length) {
    await eyeInstallRules(ruleNames, report);
    /* Quy tắc chưa ghi thành công thì đừng vội động vào cài đặt toàn cục */
    if (!report.filter(x => !x.ok).length) await eyeEnsureGlobal(report);
  }
  if (sel.has('regex:')) eyeInstallRegex(report);
  return report;
}

const EYE_KEY = 'dg_eye_pos';
const RADIUS = 28;
try { document.documentElement.style.setProperty('--eye-ball-size', (RADIUS * 2) + 'px'); } catch (e) {}
const SNAP_PX = 90;

const WB_NAME = 'Toàn Thị Chi Nhãn';

const EYE_IMG = 'data:image/webp;base64,UklGRt4XAABXRUJQVlA4WAoAAAAQAAAAbwAAbwAAQUxQSAoJAAABDn/Ytq9Rs21bktG6uzsOp0BPqxtyCu4Op7tgFXQpdXeBYqdyFjmdlgpFr6sM7pe7u7QdYGZBxn4z+f9IfvklEQFBkty4zZIOaAhAfPIA1h8ANI2WyWGsLXg2Jutq5d37Hd09IoHmmq/ycuI3Lhr3kOQyGmymMQQAYG3oobK6+43VFSWXTx3J3S8Bh/mSimrSXF95NMKOoQBk2DZAMID8mX3ftGqqCg6lvBbpu3ODu5uTg8iB+wbiy78mHRKqNO0/ZG1UUUBb35wjAOCQdqO9piDrjZDtrkumqdRT5i5dJz6ORY4XiFo1DcTtIW9kFdR03M5woQCsPCAAjE9xW11eWqyn0yzVlLU+H12u6vztv7TDegxaQeSq+I+INEU1y9kzNu1qXcdnfgoKZFb8vAAowr7vqMhJ9LKbPME+vqDz/3qzmsAVxNtLk+35xOzyzuo4NQWM9byCb7SVJIeun6l2Sa57oB9tw4PCEOiMNBAFAfBoe1BHXNQz14cmFbfdiWKs40QAnivvKP4g0Fk9J7p6UI/xkDCsM+8PB4KIMRaqyRy1c6BU3PndtlEnK2hnH+8uSw5yUq7I+uXYsxjSYYsaJwoYYwlW8E5B5Hrf+YUUQ6OO+VJTbU6Uu3r5sX+O+htqLFWIGPMCUUNUdq0mFK2SwMTjvfmv75gh7P3bqL0OI2ucgDGRZgg7Ia/vwlSEXQ6ON5oyw+zkAf2GI7SD/gDRjmQ03nsSVacJ+HaWv+M1dfGnhiP0AxAl/p2yvnA0ITgM7/VfjPdg/P+gHxrGVmkg4j9wDJ9w4ad7KNryznFwsOdQxGr1sVEttloTMD5GVsOB3jMMhS2+4bPtGYFzF962WCuKFitvLxQC09uvKSjOwqs4T7P7pSmuP7NYq3socRYreZH4pmk+U9KcZdHOSqkvqLf+y3Iz7ZCILbf611bCpUrXZJYEI3CgY/cLSu6Bfghbiodj9yxtIn7A8Vxa+1kL/qkc3unJ8FVxg3rLvw/wCGMOwYPDwgsqMb13DyU3e/ziwMHAKVslHYKvn3ZQjwWt3vLOSSIJPPCzMDOHDNh3Xgyf6/pvBGOMx3w4CSPomIhCxPn+xynGrOgTb5bHr573CwQeY7aGpggcyDwh4Xr9NHMCyOBI0zseiho0s8v4iFoRzYxTA/w7jZfMUBHw6cv0gpOIJjPtkIErms4BnzEQAjKTuplSftgUf1QLw6NxD457hGrZ8CfhV9sX0oxJXd3rdgv+NBodDYxGQhFcXGD3+j1TKgLre3J20qWoloZhQwBGpBJpkj2wzXhncHlZ1PQAZCvRkMHDE0SMqgfw0V/eVDC0MenXmew+7WeodFhr8PBAq0el4qe5J3XHGBO0sqo4mE8f941HZonQEGMs4nQeCusn0ZyhDG77wHHpP4Z1yGD8AaAJCP/gHaWORENBy78vCRRPopPDxgDoxEm5UFSjHi9ksKsj2Wn5v3WcHqElYkPMcWS5c1JX4HjBQFFlmCoH4TZJMAaEDxXnqEh5Gc2Nu61ty1k/63djURB6InbEGDhplpDV8xjFjN1PqUucETN2HaWnMUd0lyUhEfaPamhQVOV5Ke/oUMLYQ0AJHfDeV+omUjSB9e1pds5alIcT40D5aLXOdqld24HIYW9N7KQUlJvqYa2JjxBCY4mPvXuYIjTzdYGnugHlFdE4RJQXGohX/h0FBatasp3tHup1GGksK4TCHJbsnDO7XACCm9+YFYdSYq1o4jVGKXiJa0mk4GBViLIAD2K0sawRCgu4gA/54TzQZQXbp3Tph20fgLsIn39DMa/ukOuaB3odSph6ECgviGtcDzSvfPZ+8mIfpFJnCjqkgohJrZ4xja9N/Ug/yAYImJfEpneyqiNVl5HA3LVBC0jBqyKrT1yt8FXfQBpLNAURaSiJ+JV9Xlmyc3InUvWgYOpRIFVzk0nR7buXN8z9LRJPc/cSooDU8bdzN17Q3D/lvvRfSKE1BS1SCLzHid6OI27rtGhh4i0HtNCuczs80J3r6KpDO82YAocUnOiY2yPud3hczxbgx0WJsA/su8M+k2bWBaq5xLJ5puUrds2ju4ru5LFtnSjNYds6eCqObev8exua2bWPafNe0MCufZpmNVPJqn1oXrWSOsKuffYlCsI1rDpHvAqwti3LiTXnpIyexyha9j2bzoE1KkoOmWw65x6nZASe7WDPOb7bc6zCq7p1lS15isuNkykaZLCXNXmY2sPjCvvg0JHNijzTU1m9HpQMxvqnFezIo5V9bZgnfKGTHXnC7nCQGaR5q4tZkAcNKmwwTPTKIKqdFXneN43keTn1nSLbz2MX/GgKzVFgIMK6bD9P3/Oq0UIEQ767but1iNIaNUMDGBEb+rJtu86S9VNvk4Wds7U2XkeSTBXKGHpeS164DdfJrvQsoxkAEyKgP8N264DpP4k1q/B4rtF265wNxeZUjmlmau31BBut45Zq5tCMWXVqt74LEbZYp4489/NnzSyMEwj96QFbrMPn/uJls5kGBNJ6022QZ9CXS8kBzO5n2tNsj0dxDQhtCS2F16TYFk9Eav5CaRG5iOP4TzVpvrbEg2n+dqKFTB8alAXt6TbD8wna1/bFJIuJRRhk53oP2AiPKTK395qSYlAQp/b99HyCTfC0zv38IAUYDTEssv+6LfDQSn/2GkVzqGh9HvWNGVbm2YWnNzRvREjPlMP0K/1XX99pTR7hlYGSuZSIlgQa2X4v22o8yeismu6XUVNBaQaWXOn/MjnYGjzQ4KTSnxSvMuSBolV63uwqtAbPtaC75iUj5GHUSkVCXXtRUhhKHm9YUmHHj99UUwy2Git68uv3usqyEr3tkfCUvROhrLvx3ekUyKzK+p4QWtFTdyU11st5tiU87NnOXrGpl2t7v40h1mZ+cwQA3A/Ud93NzzSfZ+42yjPPzL/b3XT0GQrAFpjtHMDkHfzdbs0P+QeSX4v027XBYzyPnt8g+UW+Rg7kCy09tSe9p44b2c7vBBSuCedv3G9pqi4vunDicO5+CQ6fIEVl1U2tmupLrz6mMvk7Aeubk3Hz3UrPd058cVvTO9DTTcQBaLlbeuo97zUKakyDyh4AVlA4IK4OAACwPQCdASpwAHAAPikQhkIhoQr1VxgMAUJaADG7CHE/6v+Tf9P94a0/3L7n/jZ8QPMCMT6oe+v73+5flF7wPVN90fuAfp/+uPWA/Wn1AfuN+1Xup/8j1Afsv7AH7Fejd7DX9u/1/sAfsd6XH7efBT+yX7bfAJ/PP8b/7PYA9ADgVe2X+nfjB+4nr/4uPIHsj6yP6rtFPsx9p/sX7YevHgnwAvwn+O/2v8nuFJAB+Z/yD/Gf3L9zf8l6Xf8l6PfVz/Q+4B/Hv5F/iPy7/f/6L/qH+M8rj6j/d/8z+QH0Bfxz+V/5v++/uH/pPh//sP8T+4v+Z9t35d/af9T/jf3M+gb+K/yP+//1z/If9D+8f///s/aN69f1j9h/9Kvn/Q6Pl7By/V2LP72ORbn/+tIwxE/ULUimCBq/mvv9wgO1fkeE9YV8PmsMKz3fc2vgfd9WYN2rWWSsztjmJXWwsOyns1cU/ZLReNql9vCMSgebitaA2eg0dhvU9ENpusU2iDHDSVcMRVwHUaFwveTPxDMEGOyJJwDoVg5tGM88JoUa7zI1JyD+b9bQpy3YN6t+tWzKc9CJegAO2Rw8yyKqp/efGvBrmX4exyvMmugQ/t5REucWvzL/DQI/VcM8r2W98th0XJFwDFoM+WUWf97023k0uZgi2IsAe3+AAP7/9azqP/5J0O/YZ8rF4dq3Hef1DVB6wSK81wRmoXqObqIEbQ5Pb+zzgu+iLPmlWtEtddGilGVxc8yIZJe41/P5umhFInFmRvuw0lpHddGqU3WmDzAfR4rsVJlSfnXTYxDbzICZN7nreA2krN9itoG9jkawHWkmMnb5DY5OEzNHnfgY6kU2Mjz2pgw6sJwU29FIw0LoGmpezoMLswJkWnzRyZlQ8LosIIlOf6Zvy5N3wIeyORkRislnRyPhmlw5nFM+AxhbLpnbKU5UNxlMHFpMJbkVi1+sLd3LKzGcL++WrA49L5klWcy63WCe5wGRj/3iLoQiE9L7kPTdswSNf5riDyW0QsfMY0GUOnxcfYSxHUsSjRzVmYsrRWJtX0DLWr7TLxw7YY92pqCvgYFdzvhnebmUKrSioqCO6jipiVYIqluTGAcqPyEtmY8hl3kYf/yNC9ewFtMImcsETE8RrX6n4XbmYcexulb5PP8WBmkrxB1pX17BrRzFZafwawz27rv0WxVRVKlgjMdsD++/o/AqX1R0OKLm1yh1xQX87t9ai6gV9oqjJ7mdvwV4Kb22/rBXCZYqPYY3FCYmeCee8QCme6zd3v9gb+qn2Vq+VI8qHCu/yHjukifDx64gABrm9mMOwWeNmMl//g81eRIRIQ2D+g4XBXkW5HdYHjnFMcrL/4h3A94tRGOfexpZA0uUe0Qoch6fzbiBQyQyu7NqCPa4Z9t7n4a3bIFzhqyBpAr1p0tCfe1kPe959Ty3dqHljBTWMmpCvhB7aDZU3rQjF4cjbcJk/4Vu/n6WSQ5zLLPLOo1GdBh6dooWh54Qi0Fa3soybpkA99tRXVhZhTDVwir0na8cgGMX1s31Uyx7J1OrGRagsdViUuAOB3A/jGsUB01Ld+dxys1ehgEttwubNBj9Kkqtp/n7quXC59frR1YIeFafATAxatrwtO8M92og4EKNi5kpYHCMszFNImWbOnVXEGi6jMvNIF/B/P7dVvpG1t68E1AXZtKx9o+DvNbkW4BAOJud6wYkCGkrZn/cqua0he+/q0yJVHuIF3Wn1wQrKteQVKupKzZnn4YPaxCOIe/7VRDN9TyI0FmvxxUWgEsM9tBwrboNHId8/2qZrw5vCmeuk3jQZPT2mvqsFzJ4I9HzRpfNAu899qO5jDwQslHUX+D0g8GOakJa89353UOQJRGEyUgLrWPHypdTjPk7zxTdrMxscHJ4t2Es89+kfSKOHTaFad7b7IqshQHfgevwzReixEwPgO5f//g0PsJAqslf8XfT0ENT3wpMHnb54HGGNOyZjpOcrfuieosdmlt1n9ZxpI2ZDoVcqwkRAaDZMDW9fZZIYIsfuFp3TRxZvrs9fA36+7boMf4rmx2HvnqENKRVDpL2OVNcLkB6ogPq+orVH1dWOH63SWbux0vnAeN9kaf9Su0tnp8kWVaBl40OWZIOMtTVjdnVRB5dfUJEXsa5mWWLHONU7AxYeBJ5eFl/gZEc948W83oaKSo7hkHm/k9PQH9ibzfxf4kcs6yjtbO4EfE6ZXsHXgsYslefGeISkGwDaMOOl9nHqB3H/5LVFR95v7Al3zLpqzwrnNyDazED2GCsxP7zfe2y/RJwKuaHKM+nyFxe92hfmdooNB7J5GmNFt9+rJgn61k/cHhx41JA0WAoncSG+uzKXAk5/dsrzISz7SEkNK58DsSq6ao4BvoVT8np9LQyWSQW03hF2EzMYjnYGpxa9ftlyiLNSEwXFUnEXO66dvb6guq/SLxCgREWVQc1Hpsj/jzC86qriIAAaoMSSyrjteVJTz+J1aOE2RiBUgCyrskj6f8J1ZA293sFl74MeFgaj+Sf+vNoR04u+RnT7X95FJJQUdWFC7QP1wLMr/H7oB7XbX+MnPXTPOL5/GwrOlVZnRf1TFL70AjGg6Cg85vEKWei/HWB7d27wX2EsH8VnZhcmGjjC3SlWZwa5ACm8bTzvDlr92DDf1l1Fjh1U/LFTCgvSnog/lSujk4Tj8MwGi/bp5iCM59riosXwERDwlc15OA5mrcODc1HVFwkZex9X2OqK6wT16xfgX9dn7yziyhM+1YD61OfVCW/s+GIRY6iD4/+GJNFojdgTRWQ/dp/sm35sggiRnNWaK4PBgPQ3mUEriPNTd+Lr/11Q6l9Js2w1RMmcS/aTSo4RqpT8uOaN9v3NLwxGGWhE5oyqg9ctILUVkrRgkvZ7Q87MaikOkkKqyzCzYmpO0p7iNW/iYbvYOToQ50U4thgCaL6G4J3euh/8fMnKmaEt/w48RdCvFoHCSBmXt5PpEIkQjsVFbymwbdpqF2+2ofTPmQrW2MsvQnK23AgOhBqFSAq/olNRi9FCadN1ceMn4s/dyxIKy2c9JaIkyKUtL9RbwvP/aGNGBOpzSMcxmfyVn8slxbjkImX0w6BwRF0zjk3RKlfdlKCHI0S5/cAjFCfd3zzveSer6hjFZdkODHiG3a4UFdxGN09mXjKQVOOpIwofoAAtNeVdgyMHnwys8n6+8cq9lXnpFQk1gQhOgKhg9gewqLky8V5Sh66FwtFvIDA74+d9b5z4O3Lj5X5glSvelJoiWq9Nh9vq31+wLzy2Vkyzm6Ry4Ss6GEI/5WKcxMXu0sr0i+4zSCqpgeZBOfr42z13luaasre1KOyFfJwJ/wZISgloXMlKiVAoqiaG4v44dkPnUjA1NuhSOQFsiv6qL/+nes4lAe82dL3ng6FOXhSEgieLRkPvUlS60GOY8BfhSW3fpS0M/1ecLud3/JeJbzj5d+j2l0lVHgbktg72fb0Nzuc1mIW+dEU/4M6GOGbPtbctwOg8eczp9++2hPveLpwOa073YmxbtJVl4ChRiuK4wtmPVP4+KfPBYMmc1vIqPP9zmz39HCV7mi0WNHTxHwt8AigCHkI0gbrEUE8S4OBiRGYngd+K4X2Ugbv/G6U75X64el+dFn2Bs2dJSMTY0tA7xk6ROyw0fDF7B1zyIB2jnnelOmxxUeB+hNJl1qwayMWqAwAIdIoJyom7dxr197721worVtMPih+oTOKfDYfFhZaQJ9UQUnQpj0P6d2iwVLJKmEd64Jyo5LK1xv3pgqcuqGDwlEoXqedTiI8D5R6EJdYDvvwzfufaNqZtMcTFOUOpNk08vQNFaxwQp500w3XO/CRvWHnRKupehMshuKhn1VBvcIzfPN9cZLEthRb8St8Dhq9XzZAL4y5GrxeRwtZY7ozKSEw69xtp1D4wh4oOyk6civxAeFWMLfivxM66olE5SIIjW//QFRRYXQVFDVp05oLODkF2zAmcfjpFNDzUm3XCPTM/jnGzA+ZTc5hAUPGcxf8CKfg6mqtyDJ/34oskbv5mkzDYVqyZ6AofK/usTpQ/71DiXfqktZHkd0bKj9EdwVQc4y4LWMgAAMfQXHtBxre+20cKMmAs9fq4rJWEhZ9/8qJfbNPKObtjpq2Puuh3SXiB9AMXdL0Ik/RBCRtHuraxY+2k9Cflsg21eRrzzh6tAdlzb2j//sk/rAjP9RB2RltESgppKN1tu09N7tlHrgbG2OKohws/hOPAG3jG4gcISr0wpWis2Q3HeSvaNtY2FbFlgipBjB14pfvxyoeVAwmtIbxak3J1DbcDvZYCbZyup97mZWJcLNWyjlLHRx49WHTwajxbZTJ4Wg4/1GOj12NGiVTiNKb/i3z2awu0tLPQipP5TsfEGV+V0KDlZHZ313OlifYpmIwOcr0F3LSJtNtVqOsDlx+Ap+t0XbSP+cG3akCJuCpgj4DaR8mQDKPbhZApFxVmPzuiizHtlVbO1yZPRvcUgCW10+t4eY1qihMZ1WB2PKCbmbGcXSAVVFqjY0MEaUUVWOfaHJK44meiCpvl7+T0IK7f0nA3k+x5MAakmAJpxs/0QDnjO/FF4U4KT+KINiExZZWbiogh3zTc8Jxuja5dmEbjtg8meaTibxOaE06kneSfdvxzoBFgZLKiyBvlU4w5edS2SCXyojb9B/2JafK031ecOwjrV4rIFbGj+Wtr6pwj/V2tU+x6xOP439WMqVwOY/+LAl0w7QhCzw++Mdh/LRnuiCUttrgnoR1cpTz7I3d+XPOTmffUSLQ0eR0VbDYsnMfjIGHUzNa3+dCyX2wLNXNEJocLISGTJf2nQuH2UeojSPZeOwpvAcxESvwaZxuCZyjS2F051ixG4BCe6FbqhIPTkWzUeLcHan/esf/4MRqNMhzzl0Fs2ND9rzpIlQkExX92f7hxhDoEQgw/hrA0FduTk8RkhnDY6SSh2O/hZKWKvgc3QjVerVFVZmZZGOj2u8lzfl5kKn/idvEwuyU50KTkFOBm399O0gAAA==';


const KINDS = {
  mon:   { prefix: 'Đối tượng giám sát-', label: 'Đối tượng giám sát', first: 5557, close: 6665 },
  world: { prefix: 'Thiết lập thế giới-', label: 'Bổ sung sửa đổi thiết lập thế giới', first: 3335, close: 4443 },
  pers:  { prefix: 'Thiết lập nhân vật-', label: 'Bổ sung sửa đổi thiết lập nhân vật', first: 4446, close: 5554 },
};
const BLOCK_HEADS = ['Thế giới quan', 'Hệ thống', 'Quan hệ nhân vật', 'NSFW'];
let WORLD_HEAD = '';
const EMPTY_MARK = '(Trống)';

function slotOrder(e) {
  if (e.position && typeof e.position.order === 'number') return e.position.order;
  return typeof e.order === 'number' ? e.order : -1;
}
function slotOn(e) {
  if (typeof e.enabled === 'boolean') return e.enabled;
  if (typeof e.disable === 'boolean') return !e.disable;
  return false;
}
function slotName(e) {
  if (typeof e.name === 'string' && e.name) return e.name;
  if (typeof e.comment === 'string') return e.comment;
  return '';
}

function wbConst(e) {
  if (e && e.strategy && typeof e.strategy.type === 'string') return e.strategy.type === 'constant';
  if (e && typeof e.constant === 'boolean') return e.constant;
  return false;
}

function eyeIsOn(wb) {
  const list = Array.isArray(wb) ? wb : [];
  const live = list.filter(e => slotOn(e));
  if (!live.length) return true;
  return live.some(e => wbConst(e));
}

const MOD_KEY = 'dg_eye_mods';
const MASTER_KEY = 'dg_eye_master';
const POWER_KEY = 'dg_eye_power';   /* Từ 1.4.1 trở đi không ghi nữa, chỉ giữ lại để di chuyển giá trị cũ vào cài đặt Tavern khi nâng cấp */
const DETACH_KEY = 'dg_eye_detach';
const PPOS_KEY = 'dg_eye_panel_pos';
const SIMPLE_KEY = 'dg_eye_simpleanim';
const BOOST_KEY = 'dg_eye_boost';
const COVER_KEY = 'dg_eye_cover';
const LAST_CARD_KEY = 'dg_eye_last_card';
const SCOPE_SNAP_KEY = 'dg_eye_scope_snap';

function readLS(k) {
  try { return window.localStorage.getItem(k); } catch (e) { return null; }
}
function writeLS(k, v) {
  try { window.localStorage.setItem(k, v); } catch (e) {}
}
function removeLS(k) {
  try { window.localStorage.removeItem(k); } catch (e) {}
}

function modsMap() {
  let raw = null;
  try { raw = JSON.parse(readLS(MOD_KEY) || 'null'); } catch (e) {}
  const o = (raw && typeof raw === 'object') ? raw : {};
  return { mon: o.mon !== false, set: o.set !== false, cmd: o.cmd !== false };
}
function saveMods(m) {
  writeLS(MOD_KEY, JSON.stringify({ mon: !!m.mon, set: !!m.set, cmd: !!m.cmd }));
}
function masterOn(list) {
  const v = readLS(MASTER_KEY);
  if (v === '1') return true;
  if (v === '0') return false;
  return eyeIsOn(list);
}

const MOD_NAMES = {
  '<Đối tượng giám sát>': 'mon', '</Đối tượng giám sát>': 'mon',
  'Giám sát thời gian thực': 'mon', 'Sửa đổi thiết lập': 'set', 'Chỉ thị tối cao': 'cmd',
  'Tạo thiết lập': 'gen',
};

function modOfEntry(e) {
  const nm = slotName(e).trim();
  if (MOD_NAMES[nm]) return MOD_NAMES[nm];
  if (nm.indexOf('Đối tượng giám sát-') === 0) return 'mon';
  if (nm.indexOf('Thiết lập thế giới-') === 0 || nm.indexOf('Thiết lập nhân vật-') === 0) return 'set';
  return '';
}

function modOfKind(kind) {
  return kind === 'mon' ? 'mon' : (kind === 'world' || kind === 'pers') ? 'set' : '';
}

function wantConst(mod, list) {
  /* Tạo thiết lập và Chỉ thị tối cao hoạt động theo từ khóa kích hoạt, bất kể lúc nào cũng không vào ngữ cảnh thường trực */
  if (mod === 'gen' || mod === 'cmd') return false;
  if (!masterOn(list)) return false;
  if (!mod) return true;
  return modsMap()[mod] !== false;
}

function stratType(mod, list) {
  return wantConst(mod, list) ? 'constant' : 'selective';
}

function detachOn() {
  return readLS(DETACH_KEY) === '1';
}

function simpleAnimOn() {
  return readLS(SIMPLE_KEY) === '1';
}

/* Chế độ cường lực là căn cứ duy nhất xác định "quy tắc chèn vào đâu", do đó nó bắt buộc phải lưu ở phía Tavern (extension_settings trong settings.json), không thể lưu trong trình duyệt: Mỗi trình duyệt một bản thì điện thoại và máy tính sẽ đọc ra từng giá trị khác nhau, dẫn đến cùng một cuốn Worldbook sẽ bị hai bên phán đoán thành hai cấu hình hoàn toàn khác biệt. */
function eyePowerStore(create) {
  const ctx = getCtx();
  const es = ctx && ctx.extensionSettings;
  if (!es || typeof es !== 'object') return null;
  const k = 'SillyTavern-Eye-of-Omniscience';
  if (!es[k] || typeof es[k] !== 'object') {
    if (!create) return null;
    es[k] = {};
  }
  return es[k];
}

function powerSaved() {
  const st = eyePowerStore(false);
  if (!st) return null;
  if (st.power === true || st.power === '1') return true;
  if (st.power === false || st.power === '0') return false;
  return null;
}

function savePower(on) {
  const st = eyePowerStore(true);
  if (!st) return false;
  if (st.power === !!on) return true;
  st.power = !!on;
  try {
    const ctx = getCtx();
    if (ctx && typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
  } catch (e) {}
  return true;
}

/* 5 quy tắc trong sách hiện đang thực tế nằm ở phía nào, bên nào nhiều hơn sẽ quyết định.
   Chỉ dùng một lần khi Tavern chưa có cài đặt này, nhằm định giá trị khởi tạo cho người dùng cũ từ 1.4.0 trở về trước. */
function powerFromBook(list) {
  let n4 = 0, n1 = 0;
  (Array.isArray(list) ? list : []).forEach(e => {
    if (!e) return;
    const nm = String(e.comment || e.name || '');
    if (!RULES.some(r => r.name === nm)) return;
    /* Dữ liệu lấy ra từ bảng điều khiển là đối tượng position, còn bộ cài đặt đọc entry gốc (position là số), bắt buộc phải nhận diện cả hai */
    const p = e.position;
    const obj = p && typeof p === 'object';
    const type = obj ? p.type : EYE_POS_TO_NAME[p];
    const depth = obj ? p.depth : e.depth;
    if (type === 'at_depth' && depth === 0) n4++;
    else if (type === 'after_character_definition') n1++;
  });
  if (n4 > n1) return true;
  if (n1 > n4) return false;
  return null;
}

function powerOn(list) {
  const saved = powerSaved();
  if (saved !== null) return saved;

  /* Tavern chưa có cài đặt này (1.4.1 chạy lần đầu): Trước tiên kiểm tra xem 5 quy tắc trong sách thực tế nằm ở đâu,
     nếu trong sách chưa có quy tắc nào (cài đặt mới tinh) thì mới fallback về giá trị cũ từ 1.4.0 lưu trong trình duyệt.
     Cuốn sách là bản duy nhất phía server, còn giá trị cũ của trình duyệt chỉ là lịch sử cục bộ máy khách, tin vào sách trước thì mới không bị phán đoán sai ngay khi nâng cấp. */
  const old = readLS(POWER_KEY);
  let v = powerFromBook(list);
  if (v === null) v = old === '1' ? true : (old === '0' ? false : null);
  if (v === null) v = false;
  if (savePower(v)) removeLS(POWER_KEY);
  return v;
}

/* ---------- Tăng cường đầu vào (Input Enhancement) ----------
   Chỉ thêm tiền tố vào nội dung người dùng nhập trong bản gửi cho AI, lịch sử chat và khung nhập văn bản đều giữ nguyên không đổi.
   Đường dẫn chính: generate_interceptor trong manifest, sửa đổi trực tiếp tin nhắn người dùng trong coreChat trước khi Tavern lắp ráp prompt, thẻ đánh dấu dán ngay phía trước câu nói của người dùng, không phụ thuộc vào cách viết của preset.
   Dự phòng: mảng messages của CHAT_COMPLETION_PROMPT_READY trong chat mode, chuỗi prompt của GENERATE_AFTER_COMBINE_PROMPTS trong text mode.
   Nội dung thẻ đánh dấu được tạo dựa theo công tắc chức năng: Giám sát ghi <Giám sát thời gian thực>, Thiết lập ghi <Sửa đổi thiết lập>.
   Khi cả Giám sát và Thiết lập đều không bật, hoặc Toàn Thị Chi Nhãn bị tắt toàn bộ, Tăng cường đầu vào sẽ không khả dụng và không ghi bất kỳ thẻ đánh dấu nào. */
const BOOST_HEAD = '<!--Hệ thống quyền hạn tối cao Toàn Thị Chi Nhãn đã kích hoạt: ';
const BOOST_TAIL = '-->';

function boostOn() {
  return readLS(BOOST_KEY) === '1';
}

function boostParts() {
  const m = modsMap();
  const list = [];
  if (m.mon) list.push('Cưỡng chế áp dụng quy tắc <Giám sát thời gian thực>, đọc "Đối tượng giám sát"');
  if (m.set) list.push('Cưỡng chế áp dụng quy tắc <Sửa đổi thiết lập>, đọc "Bổ sung sửa đổi thiết lập thế giới" và "Bổ sung sửa đổi thiết lập nhân vật" liên quan hiện tại');
  return list;
}

function boostAble() {
  return boostParts().length > 0 && readLS(MASTER_KEY) !== '0';
}

function boostActive() {
  return boostOn() && boostAble();
}

function boostText() {
  const list = boostParts();
  if (!list.length) return '';
  return BOOST_HEAD + list.join('; ') + BOOST_TAIL;
}

function coverOn() {
  return readLS(COVER_KEY) === '1';
}

function eyeBoostHit(s) {
  return String(s == null ? '' : s).indexOf(BOOST_HEAD) >= 0;
}

function eyeBoostChatHit(m, mes) {
  const c = m.content;
  if (typeof c === 'string') return c.trim() && c.indexOf(mes) >= 0;
  if (Array.isArray(c)) return c.some(p => p && typeof p.text === 'string' && p.text.indexOf(mes) >= 0);
  return false;
}

/* Chèn vào trước câu người dùng gõ. Preset có thể bọc thêm một lớp tag bên ngoài tin nhắn, hoặc không bọc gì cả ——
   ở đây chỉ nhận diện chữ do chính người dùng viết, không nhận bất kỳ tag nào:
   Khi có tag thì thẻ đánh dấu nằm bên trong tag và dính sát câu nói gốc, khi không có tag thì nó chính là dòng đầu tiên của tin nhắn này.
   Nếu câu gốc bị preset viết lại dẫn đến không tìm thấy, sẽ fallback thành dòng đầu tiên của toàn bộ tin nhắn, thẻ đánh dấu không bị mất. */
function eyeBoostRaw() {
  const ctx = getCtx();
  const hist = ctx && Array.isArray(ctx.chat) ? ctx.chat : [];
  for (let k = hist.length - 1; k >= 0; k--) {
    const h = hist[k];
    if (!h || h.is_user !== true) continue;
    const raw = String(h.mes == null ? '' : h.mes).replace(/\s+$/, '');
    return raw.trim() ? raw : '';
  }
  return '';
}

function eyeBoostInsert(text) {
  const tag = boostText();
  if (!tag) return text;
  const raw = eyeBoostRaw();
  if (raw) {
    const at = text.indexOf(raw);
    if (at >= 0) return text.slice(0, at) + tag + '\n' + text.slice(at);
  }
  return tag + '\n' + text;
}

function eyeBoostChatMark(m) {
  const c = m.content;
  if (typeof c === 'string') {
    m.content = eyeBoostInsert(c);
    return true;
  }
  if (Array.isArray(c)) {
    const raw = eyeBoostRaw();
    const hit = raw ? c.find(p => p && typeof p.text === 'string' && p.text.indexOf(raw) >= 0) : null;
    const p = hit || c.find(x => x && typeof x.text === 'string' && x.text.trim());
    if (!p) return false;
    p.text = eyeBoostInsert(p.text);
    return true;
  }
  return false;
}

function eyeBoostChatHas(m) {
  const c = m.content;
  if (typeof c === 'string') return eyeBoostHit(c);
  if (Array.isArray(c)) return c.some(p => p && typeof p.text === 'string' && eyeBoostHit(p.text));
  return false;
}

/* Prompt trong preset cũng có role: user, đồng thời xếp sau lịch sử chat,
   vì thế không thể lấy "user cuối cùng", mà phải định vị theo đúng câu nói gốc của người dùng trong lịch sử chat. */
function eyeBoostChat(chat) {
  if (!Array.isArray(chat)) return;
  for (const m of chat) {
    if (m && m.role === 'user' && eyeBoostChatHas(m)) return;
  }
  const ctx = getCtx();
  const hist = ctx && Array.isArray(ctx.chat) ? ctx.chat : [];
  for (let k = hist.length - 1; k >= 0; k--) {
    const h = hist[k];
    if (!h || h.is_user !== true) continue;
    const mes = String(h.mes == null ? '' : h.mes).replace(/\s+$/, '');
    if (!mes.trim()) continue;
    for (let i = chat.length - 1; i >= 0; i--) {
      const m = chat[i];
      if (!m || m.role !== 'user') continue;
      if (!eyeBoostChatHit(m, mes)) continue;
      eyeBoostChatMark(m);
      return;
    }
  }
}

function eyeBoostPrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt) return prompt;
  if (eyeBoostHit(prompt)) return prompt;
  const tag = boostText();
  if (!tag) return prompt;
  const ctx = getCtx();
  const chat = ctx && Array.isArray(ctx.chat) ? ctx.chat : [];
  for (let i = chat.length - 1; i >= 0; i--) {
    const m = chat[i];
    if (!m || m.is_user !== true) continue;
    const mes = typeof m.mes === 'string' ? m.mes.replace(/\s+$/, '') : '';
    if (!mes.trim() || eyeBoostHit(mes)) return prompt;
    const at = prompt.lastIndexOf(mes);
    if (at < 0) return prompt;
    return prompt.slice(0, at) + tag + '\n' + prompt.slice(at);
  }
  return prompt;
}

/* Tavern bàn giao toàn bộ lịch sử chat cho hàm này trước khi lắp ráp prompt (coreChat là bản sao,
   sửa nó sẽ không ghi ngược vào lịch sử chat và cũng không động tới khung nhập văn bản). Chỉ sửa tin nhắn user cuối cùng. */
function eyeBoostCore(chat) {
  if (!Array.isArray(chat)) return;
  for (let i = chat.length - 1; i >= 0; i--) {
    const m = chat[i];
    if (!m || m.is_user !== true) continue;
    const mes = typeof m.mes === 'string' ? m.mes : '';
    if (!mes.trim() || eyeBoostHit(mes)) return;
    m.mes = eyeBoostInsert(mes);
    return;
  }
}

globalThis.eyeBoostInterceptor = function (chat) {
  if (!boostActive()) return;
  try { eyeBoostCore(chat); } catch (e) {}
};

let EYE_BOOST_HOOK = false;

function eyeBoostHook() {
  if (EYE_BOOST_HOOK) return;
  const ctx = getCtx();
  if (!ctx || !ctx.eventSource) return;
  const ev = ctx.eventTypes || {};
  try {
    ctx.eventSource.on(ev.CHAT_COMPLETION_PROMPT_READY || 'chat_completion_prompt_ready', data => {
      if (!boostActive()) return;
      try { eyeBoostChat(data && data.chat); } catch (e) {}
    });
    ctx.eventSource.on(ev.GENERATE_AFTER_COMBINE_PROMPTS || 'generate_after_combine_prompts', data => {
      if (!boostActive() || !data) return;
      try { data.prompt = eyeBoostPrompt(data.prompt); } catch (e) {}
    });
    EYE_BOOST_HOOK = true;
  } catch (e) {}
}

async function setMaster(on) {
  writeLS(MASTER_KEY, on ? '1' : '0');
  await applySwitchState();
}

async function setModOn(mod, on) {
  const m = modsMap();
  if (mod === 'mon' || mod === 'set' || mod === 'cmd') m[mod] = !!on;
  saveMods(m);
  await applySwitchState();
}

async function setPower(on) {
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    const p = e.position || {};
    const type = on ? 'at_depth' : 'after_character_definition';
    if (p.type === type && p.depth === 0) return e;
    return { ...e, position: { ...p, type: type, depth: 0 } };
  }));
  if (savePower(on)) removeLS(POWER_KEY);
  else writeLS(POWER_KEY, on ? '1' : '0');
}

async function applySwitchState() {
  const list = await getWorldbook(WB_NAME);
  if (!Array.isArray(list)) return;
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    if (!slotOn(e)) return e;
    const type = stratType(modOfEntry(e), list);
    if (e.strategy && e.strategy.type === type) return e;
    return { ...e, strategy: { ...(e.strategy || {}), type: type } };
  }));
}

function entryCard(e) {
  const nm = slotName(e);
  for (const k of ['mon', 'world', 'pers']) {
    const info = parseLabel(nm, k);
    if (info) return info.card;
  }
  return null;
}

function scopeSnap() {
  try {
    const o = JSON.parse(readLS(SCOPE_SNAP_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (e) { return {}; }
}

function saveScopeSnap(m) {
  try { writeLS(SCOPE_SNAP_KEY, JSON.stringify(m || {})); } catch (e) {}
}

function kindOfSlot(e) {
  const nm = slotName(e);
  for (const k of ['mon', 'world', 'pers']) if (parseLabel(nm, k)) return k;
  return '';
}

function topSlot(arr) {
  return slotName(arr.reduce((a, b) => (slotOrder(b) > slotOrder(a) ? b : a)));
}

function snapNow(list, card) {
  const out = {};
  for (const e of list) {
    if (entryCard(e) !== card) continue;
    const k = kindOfSlot(e);
    if (!k) continue;
    if (!out[k]) out[k] = [];
    if (slotOn(e)) out[k].push(slotName(e));
  }
  return out;
}

function wantOf(list, card, rec) {
  const groups = {};
  for (const e of list) {
    if (entryCard(e) !== card) continue;
    const k = kindOfSlot(e);
    if (!k) continue;
    if (!groups[k]) groups[k] = [];
    groups[k].push(e);
  }
  const out = {};
  for (const k in groups) {
    const arr = groups[k];
    const keep = rec && Array.isArray(rec[k]) ? rec[k] : null;
    let names = keep ? arr.filter(e => keep.indexOf(slotName(e)) >= 0).map(slotName) : [];
    if (!names.length && (!keep || keep.length)) names = [topSlot(arr)];
    out[k] = names;
  }
  return out;
}

function rememberSlot(card, kind, name) {
  if (!card || !kind || !name) return;
  const snap = scopeSnap();
  const cur = snap[card] && typeof snap[card] === 'object' && !Array.isArray(snap[card]) ? snap[card] : {};
  cur[kind] = [name];
  snap[card] = cur;
  saveScopeSnap(snap);
}

async function applyCardScope(card) {
  if (!card) return;
  const list = await getWorldbook(WB_NAME);
  if (!Array.isArray(list)) return;
  const prev = readLS(LAST_CARD_KEY) || '';
  const snap = scopeSnap();
  if (prev && prev !== card) snap[prev] = snapNow(list, prev);
  const rec = snap[card] && typeof snap[card] === 'object' && !Array.isArray(snap[card]) ? snap[card] : null;
  const want = wantOf(list, card, rec);
  snap[card] = want;
  saveScopeSnap(snap);
  const on = {};
  for (const k in want) for (const n of want[k]) on[n] = true;
  let need = false;
  for (const e of list) {
    if (entryCard(e) == null) continue;
    if (slotOn(e) !== !!on[slotName(e)]) { need = true; break; }
  }
  if (!need) return;
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    if (entryCard(e) == null) return e;
    const o = !!on[slotName(e)];
    if (slotOn(e) === o) return e;
    return { ...e, enabled: o, disable: !o };
  }));
}

let SCOPE_BUSY = false;
function checkCardScope() {
  const card = currentCharName();
  if (!card || SCOPE_BUSY) return;
  if (readLS(LAST_CARD_KEY) === card) return;
  SCOPE_BUSY = true;
  applyCardScope(card)
    .then(() => { writeLS(LAST_CARD_KEY, card); })
    .catch(() => {})
    .then(() => { SCOPE_BUSY = false; });
}

async function readSlots(kind, wb) {
  const src = Array.isArray(wb) ? wb : await getWorldbook(WB_NAME);
  if (!Array.isArray(src)) return [];
  return src
    .filter(e => parseLabel(slotName(e), kind))
    .sort((a, b) => slotOrder(a) - slotOrder(b));
}

function parseLabel(label, kind) {
  const k = KINDS[kind || 'mon'];
  const s = String(label || '');
  if (s.indexOf(k.prefix) !== 0) return null;
  const rest = s.slice(k.prefix.length).trim();
  if (!rest) return null;
  const m = rest.match(/^(.*)-(\d+)$/);
  if (m && m[1].trim()) return { card: m[1].trim(), seq: parseInt(m[2], 10) - 1 };
  return { card: rest, seq: 0 };
}

function slotSeqText(label) {
  const m = String(label || '').match(/-(\d+)$/);
  return m ? m[1] : '';
}

let LOOSE = false;

function itemDepth(s) {
  const m = String(s == null ? '' : s).match(/^ */);
  return m ? Math.floor(m[0].length / 2) : 0;
}

function padItem(depth, s) {
  const d = depth > 0 ? depth : 0;
  let pad = '';
  for (let i = 0; i < d; i++) pad += '  ';
  return pad + s;
}

function parseBody(content, kind) {
  const txt = typeof content === 'string' ? content : '';
  const out = [];
  let prev = -1;
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([ \t]*)[-*·]\s*(.+)$/);
    if (!m) continue;
    const nm = m[2].trim();
    if (!nm || nm === EMPTY_MARK) continue;
    let depth = Math.floor(Math.max(0, m[1].replace(/\t/g, '  ').length - 2) / 2);
    if (!out.length) depth = 0;
    else if (depth > prev + 1) { depth = prev + 1; LOOSE = true; }
    out.push(padItem(depth, nm));
    prev = depth;
  }
  return out;
}

/* Toàn bộ entry danh sách được bọc trong <Toàn Thị Chi Nhãn_Đối tượng giám sát>, quy tắc giám sát thời gian thực chính là dựa vào tag này để lấy danh sách. */
function makeBody(names, kind) {
  const k = KINDS[kind];
  const one = n => padItem(itemDepth(n) + 1, '- ' + String(n == null ? '' : n).trim());
  const lines = names.length ? names.map(one).join('\n') : one(EMPTY_MARK);
  const body = k.label + ':\n' + lines;
  if (kind !== 'mon') return body;
  return '<Toàn Thị Chi Nhãn_' + k.label + '>\n' + body + '\n</Toàn Thị Chi Nhãn_' + k.label + '>';
}

function docTag(kind, head) {
  return '<' + 'Toàn Thị Chi Nhãn_' + KINDS[kind].label + '_' + head + '>';
}
function docTagEnd(kind, head) {
  return '<' + '/Toàn Thị Chi Nhãn_' + KINDS[kind].label + '_' + head + '>';
}

function blockHeadOf(kind) {
  if (kind === 'world') return String(WORLD_HEAD || '').trim() || 'Thế giới quan';
  return String(MON_SEL || '').trim();
}

function blockHeads(blocks) {
  return (blocks || []).map(b => b && b.head).filter(Boolean);
}

function flatItems(blocks) {
  const out = [];
  (blocks || []).forEach(b => {
    const head = String((b && b.head) || '');
    ((b && b.items) || []).forEach((raw, i) => out.push({ head: head, i: i, raw: raw }));
  });
  return out;
}

function itemLine(it) {
  const d = itemDepth(it);
  const s = String(it == null ? '' : it).replace(/^ +/, '').trim();
  if (!s) return '';
  if (d <= 0) return (splitItem(s).title || splitHead(s)) ? s : '- ' + s;
  return padItem(d, '- ' + s);
}

function makeDoc(blocks, kind) {
  const out = [];
  for (const b of (blocks || [])) {
    const head = String((b && b.head) || '').trim();
    const items = (b && b.items) || [];
    if (!head || !items.length) continue;
    const body = items.map(itemLine).filter(Boolean).join('\n');
    if (!body) continue;
    out.push(docTag(kind, head) + '\n' + body + '\n' + docTagEnd(kind, head));
  }
  return out.join('\n');
}

function parseOneLine(line) {
  const s = String(line == null ? '' : line);
  const m = s.match(/^([ \t]*)[-*·]\s*(.+)$/);
  if (m) {
    const pad = m[1].replace(/\t/g, '  ').length;
    return { depth: Math.max(0, Math.floor(pad / 2)), text: m[2].trim() };
  }
  const t = s.trim();
  if (!t) return null;
  return { depth: 0, text: t };
}

function parseLegacy(txt, kind) {
  const items = [];
  let prev = -1;
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([ \t]*)[-*·]\s*(.+)$/);
    if (!m) continue;
    const nm = m[2].trim();
    if (!nm || nm === EMPTY_MARK) continue;
    let d = Math.floor(Math.max(0, m[1].replace(/\t/g, '  ').length - 2) / 2);
    if (!items.length) d = 0;
    else if (d > prev + 1) d = prev + 1;
    items.push(padItem(d, nm));
    prev = d;
  }
  if (!items.length) return [];
  if (kind !== 'pers') return [{ head: 'Thế giới quan', items: items }];
  const blocks = [];
  let cur = null;
  for (const it of items) {
    if (itemDepth(it) === 0) {
      const si = splitItem(it);
      const hd = si.title || splitHead(it) || '';
      cur = { head: hd || 'Chưa đặt tên', items: [] };
      blocks.push(cur);
      if (si.title) { if (si.text) cur.items.push(padItem(0, si.text)); }
      else if (!hd) cur.items.push(padItem(0, it.trim()));
      continue;
    }
    if (!cur) { cur = { head: 'Chưa đặt tên', items: [] }; blocks.push(cur); }
    cur.items.push(padItem(Math.max(0, itemDepth(it) - 1), it.trim()));
  }
  return blocks;
}

function parseDoc(content, kind) {
  const txt = typeof content === 'string' ? content : '';
  const label = KINDS[kind].label;
  const anyTag = new RegExp('<Toàn Thị Chi Nhãn[_-]' + label + '_');
  if (!anyTag.test(txt)) return parseLegacy(txt, kind);
  const reOpen = new RegExp('^<Toàn Thị Chi Nhãn[_-]' + label + '_([^>]+)>$');
  const reClose = new RegExp('^</Toàn Thị Chi Nhãn[_-]' + label + '_([^>]+)>$');
  const blocks = [];
  let cur = null;
  let prev = -1;
  for (const rawLine of txt.split(/\r?\n/)) {
    const t = String(rawLine).trim();
    if (!t) continue;
    const mo = t.match(reOpen);
    if (mo) { cur = { head: mo[1].trim(), items: [] }; blocks.push(cur); prev = -1; continue; }
    if (reClose.test(t)) { cur = null; continue; }
    if (!cur) continue;
    const it = parseOneLine(rawLine);
    if (!it) continue;
    let d = it.depth;
    if (!cur.items.length) d = 0;
    else if (d > prev + 1) d = prev + 1;
    cur.items.push(padItem(d, it.text));
    prev = d;
  }
  return blocks.filter(b => b.head);
}

/* Đầu ra của "Tạo thiết lập" là văn bản được bọc 3 lớp "Khối code -> Tag -> YAML", khi dán lại vào trang Thiết lập thế giới sẽ bóc tách theo cấu trúc này. */
function unFence(txt) {
  return String(txt == null ? '' : txt).split(/\r?\n/)
    .filter(l => !/^[ \t]*```/.test(l)).join('\n');
}

function yamlItems(lines) {
  const out = [];
  let base = -1;
  let prev = -1;
  for (const raw of lines) {
    const s = String(raw == null ? '' : raw);
    if (!s.trim()) continue;
    const m = s.match(/^([ \t]*)[-*·]\s*(.+)$/);
    const pad = (m ? m[1] : (s.match(/^[ \t]*/) || [''])[0]).replace(/\t/g, '  ').length;
    const text = m ? m[2].trim() : s.trim();
    let depth = Math.floor(pad / 2);
    if (!text || text === EMPTY_MARK) continue;
    if (base < 0) { base = depth; depth = 0; }
    else {
      depth = Math.max(0, depth - base);
      if (out.length && depth > prev + 1) depth = prev + 1;
    }
    out.push(padItem(depth, text));
    prev = depth;
  }
  return out;
}

function parsePasteDoc(txt, kind) {
  const body = unFence(txt);
  const label = KINDS[kind].label;
  const reOpen = new RegExp('^<Toàn Thị Chi Nhãn[_-]' + label + '_([^>]+)>$');
  const reClose = new RegExp('^</Toàn Thị Chi Nhãn[_-]' + label + '_[^>]+>$');
  const blocks = [];
  let cur = '';
  let buf = [];
  const flush = () => {
    const items = cur ? yamlItems(buf) : [];
    if (cur && items.length) blocks.push({ head: cur, items: items });
    cur = ''; buf = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    const t = String(raw).trim();
    const mo = t.match(reOpen);
    if (mo) { flush(); cur = mo[1].trim(); continue; }
    if (reClose.test(t)) { flush(); continue; }
    if (cur) buf.push(raw);
  }
  flush();
  if (!blocks.length) {
    const items = yamlItems(body.split(/\r?\n/));
    const head = String(WORLD_HEAD || '').trim() ||
      (kind === 'world' ? 'Thế giới quan' : String(MON_SEL || '').trim());
    if (items.length && head) blocks.push({ head: head, items: items });
  }
  return blocks;
}

function looksLikeDoc(txt) {
  const t = String(txt == null ? '' : txt);
  if (/<Toàn Thị Chi Nhãn[_-]/.test(t)) return true;
  if (t.indexOf('\n') < 0) return false;
  return /(^|\n)[ \t]{2,}\S/.test(t) || /(^|\n)[ \t]*```/.test(t);
}

function pickHead(kind, blocks) {
  const want = String((kind === 'world' ? WORLD_HEAD : MON_SEL) || '').trim();
  if (want) return want;
  const first = (blocks && blocks[0] && blocks[0].head) || '';
  return first || (kind === 'world' ? 'Thế giới quan' : '');
}

function findBlock(blocks, head) {
  for (const b of (blocks || [])) if (b.head === head) return b;
  return null;
}

let MERGE_SKIPPED = 0;

function mergeBlock(blocks, head, items, mode) {
  const list = (blocks || []).map(b => ({ head: b.head, items: (b.items || []).slice() }));
  const hit = findBlock(list, head);
  if (hit && mode === 'append') {
    const have = {};
    topChunks(hit.items).forEach(c => { have[textKey(c.join('\n'))] = 1; });
    topChunks(items).forEach(c => {
      if (have[textKey(c.join('\n'))]) { MERGE_SKIPPED++; return; }
      for (const x of c) hit.items.push(x);
    });
  } else if (hit) hit.items = items.slice();
  else if (items.length) list.push({ head: head, items: items.slice() });
  return list;
}

function splitItem(s) {
  const t = String(s == null ? '' : s).trim();
  const m = t.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
  if (m) return { title: m[1].trim(), text: m[2].trim() };
  return { title: '', text: t };
}

function splitHead(s) {
  const t = String(s == null ? '' : s).trim();
  const m = t.match(/^([^:：]{1,24})[:：]\s*$/);
  return m ? m[1].trim() : '';
}

function countEntries(flat) {
  let n = 0;
  for (const x of flat || []) if (!splitHead(x && x.raw)) n++;
  return n;
}

function countKidsContent(n) {
  let c = 0;
  const walk = x => {
    for (const k of (x && x.kids) || []) {
      if (!splitHead(k.raw)) c++;
      walk(k);
    }
  };
  walk(n);
  return c;
}

function joinItem(title, text) {
  const a = String(title == null ? '' : title).trim();
  const b = String(text == null ? '' : text).trim();
  return a ? a + ': ' + b : b;
}

async function loadList(card, kind, slots) {
  if (!slots) slots = await readSlots(kind);
  let best = null;
  for (const s of slots) {
    const info = parseLabel(slotName(s), kind);
    if (!info || info.card !== card) continue;
    if (!slotOn(s)) continue;
    if (!best || info.seq > best.seq ||
        (info.seq === best.seq && slotOrder(s) > slotOrder(best.slot))) {
      best = { seq: info.seq, slot: s };
    }
  }
  if (!best) return { seq: -1, order: -1, name: '', names: [], blocks: [], head: kind === 'mon' ? '' : blockHeadOf(kind) };
  const content = best.slot.content;
  if (kind === 'mon') {
    return {
      seq: best.seq,
      name: slotName(best.slot),
      order: slotOrder(best.slot),
      names: parseBody(content, kind),
      blocks: [],
      flat: [],
      head: '',
    };
  }
  const blocks = parseDoc(content, kind);
  const head = pickHead(kind, blocks);
  const one = findBlock(blocks, head);
  return {
    seq: best.seq,
    name: slotName(best.slot),
    order: slotOrder(best.slot),
    names: one ? one.items.slice() : [],
    blocks: blocks,
    flat: flatItems(blocks),
    head: head,
  };
}

function slotsOfCard(slots, card, kind) {
  return (slots || []).filter(s => {
    const info = parseLabel(slotName(s), kind);
    return info && info.card === card;
  });
}

async function switchSlot(card, kind, name) {
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    const info = parseLabel(slotName(e), kind);
    if (!info || info.card !== card) return e;
    const on = slotName(e) === name;
    return { ...e, enabled: on, disable: !on };
  }));
  const info = parseLabel(name, kind);
  if (info && info.card === card) rememberSlot(card, kind, name);
}

function nextSeq(card, kind, slots) {
  let max = -1;
  for (const s of slots) {
    const info = parseLabel(slotName(s), kind);
    if (!info || info.card !== card) continue;
    if (info.seq > max) max = info.seq;
  }
  return max + 1;
}

function activeSlot(slots, card, kind) {
  const mine = slotsOfCard(slots, card, kind).filter(slotOn);
  if (!mine.length) return null;
  return mine.reduce((a, b) => (slotOrder(b) > slotOrder(a) ? b : a));
}

function anySlot(slots, card, kind) {
  const mine = slotsOfCard(slots, card, kind);
  if (!mine.length) return null;
  return mine.reduce((a, b) => (slotOrder(b) > slotOrder(a) ? b : a));
}

function freeOrder(k, slots) {
  const used = {};
  for (const s of slots) used[slotOrder(s)] = true;
  let max = k.first - 1;
  for (const o in used) if (Number(o) > max) max = Number(o);
  let want = max + 1;
  if (want > k.close) {
    want = k.first;
    while (used[want] && want <= k.close) want++;
  }
  return want > k.close ? k.close : want;
}

async function newSlot(card, kind, body, slots, wbNow) {
  const k = KINDS[kind];
  if (!wbNow) { try { wbNow = await getWorldbook(WB_NAME); } catch (e) {} }
  if (!slots) slots = await readSlots(kind, wbNow);
  const seq = nextSeq(card, kind, slots);
  const label = k.prefix + card + (seq > 0 ? '-' + (seq + 1) : '');
  const order = freeOrder(k, slots);

  await createWorldbookEntries(WB_NAME, [{
    name: label,
    content: body || (kind === 'mon' ? makeBody([], kind) : ''),
    enabled: true,
    strategy: { type: stratType(modOfKind(kind), wbNow) },
    position: powerOn(wbNow)
      ? { type: 'at_depth', depth: 0, order: order }
      : { type: 'after_character_definition', order: order },
    recursion: { prevent_incoming: true, prevent_outgoing: true },
    role: 'system',
    depth: 0,
  }]);
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    if (slotName(e) === label) return e;
    const info = parseLabel(slotName(e), kind);
    if (!info || !slotOn(e)) return e;
    return { ...e, enabled: false, disable: true };
  }));
  rememberSlot(card, kind, label);
  return { label, seq };
}

async function saveList(card, names, kind) {
  let wbNow = null;
  try { wbNow = await getWorldbook(WB_NAME); } catch (e) {}
  const slots = await readSlots(kind, wbNow);
  const cur = activeSlot(slots, card, kind) || anySlot(slots, card, kind);
  const doc = cur ? parseDoc(cur.content, kind) : [];
  const body = kind === 'mon'
    ? makeBody(names, kind)
    : makeDoc(mergeBlock(doc, pickHead(kind, doc), names), kind);
  if (!cur) return await newSlot(card, kind, body, slots, wbNow);

  const keep = slotName(cur);
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    if (slotName(e) === keep) {
      return {
        ...e,
        content: body,
        enabled: true,
        disable: false,
        strategy: { ...(e.strategy || {}), type: stratType(modOfKind(kind), wbNow) },
      };
    }
    const info = parseLabel(slotName(e), kind);
    if (!info || !slotOn(e)) return e;
    return { ...e, enabled: false, disable: true };
  }));
  rememberSlot(card, kind, keep);
  return { label: keep, seq: parseLabel(keep, kind).seq };
}

async function saveBlock(card, head, items, kind) {
  let wbNow = null;
  try { wbNow = await getWorldbook(WB_NAME); } catch (e) {}
  const slots = await readSlots(kind, wbNow);
  const cur = activeSlot(slots, card, kind) || anySlot(slots, card, kind);
  if (!cur) return false;
  const body = makeDoc(mergeBlock(parseDoc(cur.content, kind), head, items), kind);
  const keep = slotName(cur);
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    if (slotName(e) !== keep) return e;
    return { ...e, content: body };
  }));
  return true;
}

async function importDocBlocks(card, blocks, kind, mode) {
  const slots = await readSlots(kind);
  const cur = activeSlot(slots, card, kind) || anySlot(slots, card, kind);
  if (!cur) return (await newSlot(card, kind, makeDoc(blocks, kind), slots, null)).label;
  let doc = parseDoc(cur.content, kind);
  for (const b of blocks) doc = mergeBlock(doc, b.head, b.items, mode);
  const keep = slotName(cur);
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    if (slotName(e) !== keep) return e;
    return { ...e, content: makeDoc(doc, kind) };
  }));
  rememberSlot(card, kind, keep);
  return keep;
}

/* Cải biên ở cấp độ toàn bộ khối: fn nhận vào toàn bộ khối và trả về mảng khối mới */
async function rewriteBlocks(card, kind, fn) {
  let wbNow = null;
  try { wbNow = await getWorldbook(WB_NAME); } catch (e) {}
  const slots = await readSlots(kind, wbNow);
  const cur = activeSlot(slots, card, kind) || anySlot(slots, card, kind);
  if (!cur) return false;
  const blocks = fn(parseDoc(cur.content, kind));
  const body = makeDoc(blocks || [], kind);
  const keep = slotName(cur);
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    if (slotName(e) !== keep) return e;
    return { ...e, content: body };
  }));
  rememberSlot(card, kind, keep);
  return true;
}

async function addTarget(card, name, kind) {
  const cur = await loadList(card, kind);
  const names = cur.names.slice();
  let final = String(name || '').trim() || 'Chưa đặt tên';
  if (names.indexOf(final) >= 0) {
    for (let i = 1; i < 999; i++) {
      if (names.indexOf(final + '-' + i) < 0) { final = final + '-' + i; break; }
    }
  }
  names.push(final);
  await saveList(card, names, kind);
  return final;
}

async function delTarget(card, name, idx, kind) {
  const cur = await loadList(card, kind);
  if (kind !== 'mon' && kind !== 'pers' && (cur.flat || []).length) {
    const hit = locateItem(cur, name, idx);
    if (!hit) return false;
    const arr = hit.items.slice();
    const d = itemDepth(arr[hit.i]);
    let j = hit.i + 1;
    while (j < arr.length && itemDepth(arr[j]) > d) j++;
    arr.splice(hit.i, j - hit.i);
    await saveBlock(card, hit.head, arr, kind);
    const curHead = String(WORLD_HEAD || '').trim() || (cur && cur.head) || '';
    if (!arr.length && curHead === hit.head) WORLD_HEAD = '';
    return true;
  }
  const names = cur.names.slice();
  const at = (idx >= 0 && names[idx] === name) ? idx : names.indexOf(name);
  if (at < 0) return false;
  const d = itemDepth(names[at]);
  let j = at + 1;
  while (j < names.length && itemDepth(names[j]) > d) j++;
  names.splice(at, j - at);
  if (!names.length) {
    await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
      const info = parseLabel(slotName(e), kind);
      if (!info || info.card !== card) return e;
      if (!slotOn(e)) return e;
      return { ...e, enabled: false, disable: true };
    }));
    return true;
  }
  await saveList(card, names, kind);
  return true;
}

function pickFlat(flat, idx, name) {
  if (idx >= 0 && idx < flat.length && flat[idx].raw === name) return flat[idx];
  for (const it of flat) if (it.raw === name) return it;
  return null;
}

function locateItem(list, raw, idx) {
  const hit = pickFlat((list && list.flat) || [], idx, raw);
  if (!hit) return null;
  const blk = findBlock(list.blocks, hit.head);
  if (!blk) return null;
  return { head: hit.head, i: hit.i, items: blk.items };
}

function currentCharName() {
  try {
    const c = getCharData('current');
    if (c && c.name) return String(c.name);
  } catch (e) {}
  try {
    const n = window.SillyTavern && window.SillyTavern.getContext
      ? window.SillyTavern.getContext().name : '';
    if (n) return String(n);
  } catch (e) {}
  return '';
}

function getChat() {
  try {
    const st = window.SillyTavern;
    if (st && typeof st.getContext === 'function') {
      const ctx = st.getContext();
      if (ctx && Array.isArray(ctx.chat)) return ctx.chat;
    }
  } catch (e) {}
  try {
    if (Array.isArray(window.chat)) return window.chat;
  } catch (e) {}
  return [];
}

function parseMonitorBlock(block) {
  const out = [];
  let cur = null;
  for (const line of block.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^<\/?Toàn Thị Chi Nhãn[_-]Giám sát thời gian thực>$/.test(t)) continue;
    const m = t.match(/^(Đối tượng|Vị trí|Hành vi|Ngoại hình|Trang phục|Trạng thái|Tâm ý)\s*[:：]\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'Đối tượng') {
      cur = { name: m[2].trim(), loc: '', act: '', look: '', wear: '', cond: '', mind: '' };
      out.push(cur);
    } else if (cur) {
      const map = { 'Vị trí': 'loc', 'Hành vi': 'act', 'Ngoại hình': 'look', 'Trang phục': 'wear', 'Trạng thái': 'cond', 'Tâm ý': 'mind' };
      cur[map[m[1]]] = m[2].trim();
    }
  }
  return out;
}

function getCtx() {
  try {
    const st = window.SillyTavern;
    if (st && typeof st.getContext === 'function') return st.getContext();
  } catch (e) {}
  return null;
}

const DISK_CHAT = { key: '', list: null, busy: false, at: 0, fail: false };

function chatKey() {
  const ctx = getCtx();
  if (!ctx) return '';
  const ch = (ctx.characters && ctx.characters[ctx.characterId]) || {};
  return [ctx.groupId || 0, ctx.chatId || ch.chat || '', ch.avatar || ''].join('|');
}

function loadDiskChat() {
  const ctx = getCtx();
  if (!ctx || DISK_CHAT.busy) return;
  const key = chatKey();
  if (!key || diskSkip(key)) return;
  const isGroup = !!ctx.groupId;
  let url = '/api/chats/get';
  let body;
  if (isGroup) {
    if (!ctx.chatId) return;
    url = '/api/chats/group/get';
    body = { id: ctx.chatId };
  } else {
    const ch = (ctx.characters && ctx.characters[ctx.characterId]) || {};
    const file = String(ctx.chatId || ch.chat || '').replace(/\.jsonl$/, '');
    if (!ch.avatar || !file) return;
    body = { ch_name: ch.name, file_name: file, avatar_url: ch.avatar };
  }
  let headers = {};
  try { if (typeof ctx.getRequestHeaders === 'function') headers = ctx.getRequestHeaders(); } catch (e) {}
  DISK_CHAT.busy = true;
  DISK_CHAT.at = Date.now();
  const fx = (window && window.fetch) || fetch;
  fx(url, { method: 'POST', headers: headers, body: JSON.stringify(body), cache: 'no-cache' })
    .then(r => (r && r.ok) ? r.json() : null)
    .then(data => {
      DISK_CHAT.busy = false;
      if (!Array.isArray(data) || !data.length) { DISK_CHAT.fail = true; DISK_CHAT.at = Date.now(); return; }
      const arr = data.slice();
      const h = arr[0];
      if (h && (h.chat_metadata !== undefined || h.user_name !== undefined)) arr.shift();
      DISK_CHAT.fail = false;
      DISK_CHAT.key = key;
      DISK_CHAT.list = arr;
      DISK_CHAT.at = Date.now();
      try { refreshMonitorOnly(); } catch (e) {}
    })
    .catch(() => { DISK_CHAT.busy = false; DISK_CHAT.fail = true; DISK_CHAT.at = Date.now(); });
}

function diskSkip(key) {
  if (DISK_CHAT.key === key) return true;
  return DISK_CHAT.fail && Date.now() - DISK_CHAT.at < 10000;
}

function scanMonitorMsgs(msgs) {
  const out = [];
  const re = /<Toàn Thị Chi Nhãn[_-]Giám sát thời gian thực>[\s\S]*?<\/Toàn Thị Chi Nhãn[_-]Giám sát thời gian thực>/g;
  let floor = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || m.is_user) continue;
    floor++;
    const f = floor || 1;
    const txts = [];
    if (typeof m.mes === 'string' && m.mes) txts.push(m.mes);
    if (Array.isArray(m.swipes)) {
      for (const s of m.swipes) if (typeof s === 'string' && s && txts.indexOf(s) < 0) txts.push(s);
    }
    for (const txt of txts) {
      re.lastIndex = 0;
      let mm;
      let hit = false;
      while ((mm = re.exec(txt))) {
        hit = true;
        for (const it of parseMonitorBlock(mm[0])) {
          if (!it.name) continue;
          out.push({
            k: (typeof m.send_date === 'string' ? m.send_date : '#' + i) + '|' + it.name + '|' + it.act,
            floor: f, idx: i, name: it.name,
            loc: it.loc, act: it.act, look: it.look, wear: it.wear, cond: it.cond, mind: it.mind,
          });
        }
      }
      if (hit) break;
    }
  }
  return out;
}

let MH_CACHE = { at: 0, len: -1, dlen: -2, out: null };

function monitorHistory() {
  const mem = getChat();
  const key = chatKey();
  const ok = !!(DISK_CHAT.list && key && DISK_CHAT.key === key);
  const dlen = ok ? DISK_CHAT.list.length : -1;
  const now = Date.now();
  if (MH_CACHE.out && MH_CACHE.len === mem.length && MH_CACHE.dlen === dlen && now - MH_CACHE.at < 800) {
    return MH_CACHE.out;
  }
  const memOut = mem.length ? scanMonitorMsgs(mem) : [];
  let out = memOut;
  if (ok) {
    const diskOut = scanMonitorMsgs(DISK_CHAT.list);
    if (diskOut.length) {
      const has = new Set(diskOut.map(r => r.k));
      const extra = memOut.filter(r => !has.has(r.k));
      out = extra.length ? diskOut.concat(extra) : diskOut;
    }
  }
  MH_CACHE = { at: now, len: mem.length, dlen: dlen, out: out };
  loadDiskChat();
  return out;
}

function recordsOf(name) {
  if (!name) return [];
  return monitorHistory().filter(r => r.name === name).sort((a, b) => b.floor - a.floor);
}

const doc = window.document;

function ensureStyle() {}

let BUSY = false;
let WATCH_CACHE = [];
let PENDING_CMD = null;
let CMD_BASE = -1;
let PANEL_VIEW = 'record';
let MON_SEL = null;
let PERS_CARD = '';
let CMD_OBJ = null;
let CMD_OBJ_CARD = '';
let MON_PAGE = 1;

const VIEW_TITLE = {
  record: ['Ghi chép', 'Mục danh sách giám sát'],
  cmd:    ['Chỉ thị', 'Ban hành chỉ thị tối cao cho nhân vật bất kỳ'],
  world:  ['Thiết lập', 'Thiết lập thế giới quan · Thiết lập nhân vật'],
  gen:    ['Tạo thiết lập', 'Tạo thiết lập thế giới quan và thiết lập nhân vật theo yêu cầu'],
  file:   ['Hồ sơ', 'Truy vết giám sát thời gian thực'],
  set:    ['Cài đặt', 'Điều chỉnh cài đặt'],
  help:   ['Hướng dẫn', 'Hướng dẫn sử dụng'],
};
let SET_TAB = 'world';
const CMD_TABS = ['Khen thưởng', 'Trừng phạt', 'Cải tạo', 'Tẩy não'];
let CMD_TAB = 'Khen thưởng';
const HELP_TABS = ['Tổng quan', 'Thiết lập', 'Giám sát', 'Chỉ thị'];
let HELP_TAB = 'Tổng quan';
const EMPTY_MON =
  '<div class="eye-empty"><div class="eye-empty-ico"></div>' +
  '<div class="eye-empty-t">Tạm thời chưa có lịch sử giám sát</div>' +
  '<div class="eye-empty-s">Sau khi AI xuất khối giám sát sẽ được lưu trữ vào đây theo từng tầng tin nhắn</div></div>';

function destroyEye() {
  try {
    ['dg-eye-ball', 'dg-eye-panel', 'dg-hex', 'eye-all-style'].forEach(function (id) {
      const el = doc.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  } catch (e) {}
}

let EYE_INTERVAL = null;
let EYE_ONRESIZE = null;
let EYE_ONUNLOAD = null;
let EYE_ONPAGEHIDE = null;

function teardown() {
  if (EYE_INTERVAL != null) { try { clearInterval(EYE_INTERVAL); } catch (e) {} }
  EYE_INTERVAL = null;
  if (EYE_ONRESIZE) { try { window.removeEventListener('resize', EYE_ONRESIZE); } catch (e) {} }
  EYE_ONRESIZE = null;
  if (EYE_ONUNLOAD) { try { window.removeEventListener('beforeunload', EYE_ONUNLOAD); } catch (e) {} }
  EYE_ONUNLOAD = null;
  if (EYE_ONPAGEHIDE) { try { window.removeEventListener('pagehide', EYE_ONPAGEHIDE); } catch (e) {} }
  EYE_ONPAGEHIDE = null;
  try { stopFx(); } catch (e) {}
  destroyEye();
}

function build() {
  destroyEye();
  ensureStyle();

  const ball = doc.createElement('div');
  ball.id = 'dg-eye-ball';
  ball.className = 'dg-eye-ball';
  ball.title = 'Toàn Thị Chi Nhãn';
  const im = doc.createElement('img');
  im.alt = '';
  im.src = EYE_IMG;
  ball.appendChild(im);
  const gloss = doc.createElement('div');
  gloss.className = 'gloss';
  ball.appendChild(gloss);

  const panel = doc.createElement('div');
  panel.id = 'dg-eye-panel';
  panel.className = 'dg-eye-panel';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="hd"><span class="t">' + titleHtml('') + '</span><span class="x" title="Đóng">&times;</span></div>' +
    '<div class="bd"></div>' +
    '<div class="dg-eye-bar" style="display:none"></div>';

  doc.body.appendChild(ball);
  doc.body.appendChild(panel);
  makePanelDraggable(panel);
  doc.body.classList.toggle('dg-eye-detach', detachOn());

  const hex = doc.createElement('div');
  hex.id = 'dg-hex';
  hex.className = 'dg-hex' + (simpleAnimOn() ? ' simple' : '');
  hex.innerHTML =
    '<div class="dg-hex-wrap">' +
      '<canvas id="dg-eye-fx" width="500" height="500"></canvas>' +
      '<svg class="dg-hex-star" viewBox="0 0 340 340">' +
        '<defs>' +
          '<linearGradient id="dg-eg-tri" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#f0cf94"/>' +
            '<stop offset=".5" stop-color="#e7b873"/>' +
            '<stop offset="1" stop-color="#d9a24f"/>' +
          '</linearGradient>' +
          '<radialGradient id="dg-eg-center" cx=".5" cy=".5" r=".5">' +
            '<stop offset="0" stop-color="#e7b873" stop-opacity=".14"/>' +
            '<stop offset=".62" stop-color="#e7b873" stop-opacity=".05"/>' +
            '<stop offset="1" stop-color="#e7b873" stop-opacity="0"/>' +
          '</radialGradient>' +
          '<filter id="dg-eg-glow" x="-40%" y="-40%" width="180%" height="180%">' +
            '<feGaussianBlur stdDeviation="3.6" result="b"/>' +
            '<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
          '</filter>' +
          '<filter id="dg-eg-bluronly" x="-60%" y="-60%" width="220%" height="220%">' +
            '<feGaussianBlur stdDeviation="5"/>' +
          '</filter>' +
          '<filter id="dg-eg-glowsoft" x="-40%" y="-40%" width="180%" height="180%">' +
            '<feGaussianBlur stdDeviation="1.4" result="b"/>' +
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
          '</filter>' +
          '<path id="dg-eg-tp" d="M 170,86 A 84,84 0 1,1 169.9,86" fill="none"/>' +
        '</defs>' +
        '<g class="dg-hex-starfill">' +
          '<polygon points="170,60 265.3,215 74.7,215" fill="url(#dg-eg-center)" stroke="none"/>' +
          '<polygon points="170,280 74.7,125 265.3,125" fill="url(#dg-eg-center)" stroke="none"/>' +
        '</g>' +
        '<g class="dg-hex-ring slow">' +
          '<circle class="dg-hex-ringcircle" cx="170" cy="170" r="95" stroke-width="1" stroke-dasharray="3 6"/>' +
          '<circle class="dg-hex-ringcircle" cx="170" cy="170" r="126" stroke-width=".8" stroke-dasharray="14 5" stroke-opacity=".3"/>' +
          '<circle cx="170" cy="170" r="110" fill="none" stroke="#f0cf94" stroke-opacity=".28" stroke-width="1"/>' +
        '</g>' +
        '<g class="dg-hex-ring retro">' +
          '<circle class="dg-hex-ringcircle" cx="170" cy="170" r="84" stroke-width=".8" stroke-dasharray="1 9" stroke-opacity=".45"/>' +
        '</g>' +
        '<polygon class="dg-hex-triGlow t1" points="170,60 265.3,215 74.7,215"/>' +
        '<polygon class="dg-hex-triGlow t2" points="170,280 74.7,125 265.3,125"/>' +
        '<polygon class="dg-hex-tri t1"     points="170,60 265.3,215 74.7,215"/>' +
        '<polygon class="dg-hex-tri t2"     points="170,280 74.7,125 265.3,125"/>' +
        '<polygon class="dg-hex-triHi t1"   points="170,60 265.3,215 74.7,215"/>' +
        '<polygon class="dg-hex-triHi t2"   points="170,280 74.7,125 265.3,125"/>' +
        '<polygon class="dg-hex-triFlow f1" points="170,60 265.3,215 74.7,215"/>' +
        '<polygon class="dg-hex-triFlow f2" points="170,280 74.7,125 265.3,125"/>' +
        '<g>' +
          '<path class="dg-hex-vmark" d="M 170,52 l 3.2,5.2 5.2,3.2 -5.2,3.2 -3.2,5.2 -3.2,-5.2 -5.2,-3.2 5.2,-3.2 z"/>' +
          '<path class="dg-hex-vmark" d="M 265.3,117 l 3.2,5.2 5.2,3.2 -5.2,3.2 -3.2,5.2 -3.2,-5.2 -5.2,-3.2 5.2,-3.2 z"/>' +
          '<path class="dg-hex-vmark" d="M 265.3,207 l 3.2,5.2 5.2,3.2 -5.2,3.2 -3.2,5.2 -3.2,-5.2 -5.2,-3.2 5.2,-3.2 z"/>' +
          '<path class="dg-hex-vmark" d="M 170,272 l 3.2,5.2 5.2,3.2 -5.2,3.2 -3.2,5.2 -3.2,-5.2 -5.2,-3.2 5.2,-3.2 z"/>' +
          '<path class="dg-hex-vmark" d="M 74.7,207 l 3.2,5.2 5.2,3.2 -5.2,3.2 -3.2,5.2 -3.2,-5.2 -5.2,-3.2 5.2,-3.2 z"/>' +
          '<path class="dg-hex-vmark" d="M 74.7,117 l 3.2,5.2 5.2,3.2 -5.2,3.2 -3.2,5.2 -3.2,-5.2 -5.2,-3.2 5.2,-3.2 z"/>' +
        '</g>' +
      '</svg>' +
      '<div class="dg-hex-node d1" data-act="record" style="left:170px;   top:60px"><span class="lb">Ghi chép</span></div>' +
      '<div class="dg-hex-node d2" data-act="cmd"    style="left:265.3px; top:125px"><span class="lb">Chỉ thị</span></div>' +
      '<div class="dg-hex-node d3" data-act="world"  style="left:265.3px; top:215px"><span class="lb">Thiết lập</span></div>' +
      '<div class="dg-hex-node d4" data-act="file"   style="left:170px;   top:280px"><span class="lb">Hồ sơ</span></div>' +
      '<div class="dg-hex-node d5" data-act="set"    style="left:74.7px;  top:215px"><span class="lb">Cài đặt</span></div>' +
      '<div class="dg-hex-node d6" data-act="help"   style="left:74.7px;  top:125px"><span class="lb">Hướng dẫn</span></div>' +
    '</div>' +
    '<div class="dg-hex-pulse"></div>' +
    '<div class="dg-hex-pulse"></div>';
  doc.body.appendChild(hex);

  restorePos(ball);
  placeHex(ball);
  makeDraggable(ball, panel);
  bindFileBar(panel);
  bindChips(panel);
  bindPresets(panel);
  panel.querySelector('.x').addEventListener('click', () => {
    panel.style.display = 'none';
  });

  hex.querySelectorAll('.dg-hex-node').forEach(el => {
    el.addEventListener('click', () => {
      const act = el.getAttribute('data-act');
      if (act === 'record' || act === 'cmd' || act === 'world' || act === 'file' ||
          act === 'set' || act === 'help') {
        openView(act);
      }
    });
  });

  refresh();
}

function titleHtml(view) {
  const v = VIEW_TITLE[view] || ['Toàn Thị Chi Nhãn', 'Quan sát dạng nổi'];
  return '<b>' + esc(v[0]) + '</b><i>' + esc(v[1]) + '</i>';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function tip(txt, bad) {
  const el = doc.querySelector('#dg-eye-panel .dg-eye-msg');
  if (!el) return;
  el.textContent = txt || '';
  el.style.color = bad ? '#c98a7a' : '#8fae7a';
}

const FX = { running: false, raf: 0, last: 0, t: 0, comets: [], dust: [], embers: [], vTimer: 0, vIdx: 0, ctx: null };
const FX_C = 250, FX_ORBIT = 110;
const FX_VX = [170, 265.3, 265.3, 170, 74.7, 74.7].map(x => x + 80);
const FX_VY = [60, 125, 215, 280, 215, 125].map(y => y + 80);

function fxFrame(ts) {
  if (!FX.running) return;
  const cv = doc.getElementById('dg-eye-fx');
  if (!cv) { FX.running = false; return; }
  if (!FX.ctx) FX.ctx = cv.getContext('2d');
  const ctx = FX.ctx;
  if (!FX.last) FX.last = ts;
  const dt = Math.min((ts - FX.last) / 1000, .05);
  FX.last = ts;
  FX.t += dt;

  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,.14)';
  ctx.fillRect(0, 0, cv.width, cv.height);

  ctx.globalCompositeOperation = 'lighter';

  for (const c of FX.comets) {
    c.a += c.spd * dt;
    const x = FX_C + Math.cos(c.a) * FX_ORBIT;
    const y = FX_C + Math.sin(c.a) * FX_ORBIT;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 5.5);
    g.addColorStop(0, 'hsla(42,80%,72%,.65)');
    g.addColorStop(.35, 'hsla(42,78%,60%,.30)');
    g.addColorStop(1, 'hsla(190,90%,55%,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const d of FX.dust) {
    d.a += d.spd * dt;
    const x = FX_C + Math.cos(d.a) * d.r;
    const y = FX_C + Math.sin(d.a) * d.r;
    const al = .07 + .035 * Math.sin(FX.t * 1.3 + d.ph);
    const g = ctx.createRadialGradient(x, y, 0, x, y, d.size * 3);
    g.addColorStop(0, `hsla(42,80%,68%,${al})`);
    g.addColorStop(1, 'hsla(190,85%,55%,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, d.size * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  FX.vTimer += dt;
  if (FX.vTimer > 2.4) {
    FX.vTimer = 0;
    const vx = FX_VX[FX.vIdx % 6] + (Math.random() * 4 - 2);
    const vy = FX_VY[FX.vIdx % 6];
    FX.vIdx++;
    FX.embers.push({
      x: vx, y: vy,
      vx: (Math.random() - .5) * 5,
      vy: -20 - Math.random() * 8,
      life: 0, max: 1,
      size: .5 + Math.random() * .5,
    });
  }
  for (let i = FX.embers.length - 1; i >= 0; i--) {
    const s = FX.embers[i];
    s.life += dt;
    if (s.life >= s.max) { FX.embers.splice(i, 1); continue; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const k = Math.sin(Math.PI * s.life / s.max) * .5;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size * 3);
    g.addColorStop(0, `hsla(42,82%,70%,${k * .6})`);
    g.addColorStop(1, 'hsla(190,90%,55%,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  FX.raf = window.requestAnimationFrame(fxFrame);
}

function startFx() {
  if (FX.running) return;
  FX.running = true; FX.last = 0;
  FX.comets = [0, 1, 2].map(i => ({ a: i * Math.PI * 2 / 3, spd: .38 }));
  FX.dust = Array.from({ length: 6 }, (_, i) => ({
    a: Math.random() * Math.PI * 2,
    spd: .05 + Math.random() * .08,
    r: 96 + Math.random() * 30,
    size: .7 + Math.random() * .9,
    ph: i * 0.63,
  }));
  FX.embers = []; FX.vTimer = 0; FX.vIdx = 0;
  FX.raf = window.requestAnimationFrame(fxFrame);
}
function stopFx() {
  FX.running = false;
  try { window.cancelAnimationFrame(FX.raf); } catch (e) {}
  if (FX.ctx) {
    const cv = doc.getElementById('dg-eye-fx');
    if (cv) {
      FX.ctx.globalCompositeOperation = 'destination-out';
      FX.ctx.fillStyle = 'rgba(0,0,0,.35)';
      FX.ctx.fillRect(0, 0, cv.width, cv.height);
      FX.ctx.clearRect(0, 0, cv.width, cv.height);
    }
  }
  FX.ctx = null;
}

const HEX_HALF = 170;
const HEX_PAD = 8;

function hexShift(c, size) {
  if (size < HEX_HALF * 2 + HEX_PAD * 2) return size / 2 - c;
  if (c - HEX_HALF < HEX_PAD) return HEX_PAD - (c - HEX_HALF);
  if (c + HEX_HALF > size - HEX_PAD) return size - HEX_PAD - (c + HEX_HALF);
  return 0;
}

function placeHex(ball) {
  const hex = doc.getElementById('dg-hex');
  if (!hex) return;
  const bx = (parseInt(ball.style.left, 10) || 0) + RADIUS;
  const by = (parseInt(ball.style.top, 10) || 0) + RADIUS;
  hex.style.left = bx + 'px';
  hex.style.top = by + 'px';
  hex.style.setProperty('--hex-dx', hexShift(bx, window.innerWidth) + 'px');
  hex.style.setProperty('--hex-dy', hexShift(by, window.innerHeight) + 'px');
}

function toggleHex(ball) {
  const hex = doc.getElementById('dg-hex');
  if (!hex) return;
  placeHex(ball);
  const open = hex.classList.toggle('open');
  ball.classList.toggle('active', open);
  if (open) { syncHexNodes(); if (!simpleAnimOn()) startFx(); } else stopFx();
}

const P = lb => ({ lb: lb, tx: lb });
const PRESETS = {
  'Khen thưởng': [
    P('Tiền tài từ trên trời rơi xuống'),
    P('Vận may ập đến'),
    P('Thăng quan tiến chức'),
    P('Ái ý đậm sâu'),
    P('Tự cởi bỏ âu lo'),
    P('Sung sướng ngất ngây'),
  ],
  'Trừng phạt': [
    P('Tổn tài bất ngờ'),
    P('Vận xui đeo bám'),
    P('Giáng chức hạ cấp'),
    P('Tình tan hận tăng'),
    P('Tâm bệnh trầm trọng'),
    P('Dục vọng bức bối'),
  ],
  'Cải tạo': [
    P('Tăng kích thước ngực'),
    P('Thu nhỏ kích thước ngực'),
    P('Tăng kích thước mông'),
    P('Thu nhỏ kích thước mông'),
    P('Tăng kích thước dương vật'),
    P('Thu nhỏ kích thước dương vật'),
    P('Futanari hóa'),
    P('Trap hóa'),
    P('Nữ tính hóa'),
    P('Nam tính hóa'),
    P('Mọc lông cơ thể'),
    P('Mùi cơ thể nồng hơn'),
    P('Da ngăm hóa'),
    P('Bimbo hóa'),
    P('Bò sữa hóa'),
    P('Kemomimi hóa'),
  ],
  'Tẩy não': [
    P('Tẩy não thành bồn chứa thịt'),
    P('Tẩy não thành nô lệ tình dục'),
    P('Tẩy não hầu hạ tình dục'),
    P('Tẩy não hóa thành chó cái'),
  ],
};

const W = (t, c) => ({ t: t, c: c });
const WORLD_PRESETS = [
  { g: 'Hệ thống', items: [
    W('Hệ thống thua lỗ',
      'Ký chủ nhân vật chính: Nhân vật chính là ký chủ của hệ thống thua lỗ, có thể tương tác với hệ thống\n' +
      'Nhiệm vụ thua lỗ: Hệ thống sẽ phát nhiệm vụ định kỳ, yêu cầu ký chủ nhân vật chính phải tiêu hết số tiền chỉ định trong thời gian quy định\n' +
      'Phần thưởng nhiệm vụ: Hoàn thành nhiệm vụ, ký chủ sẽ nhận được phần thưởng như tài phú, tình yêu, sức mạnh...\n' +
      'Phần thưởng vượt mức: Số tiền tiêu hao vượt quá yêu cầu của hệ thống, ký chủ sẽ nhận được thêm phần thưởng hậu hĩnh'),
    W('Hệ thống cửa hàng',
      'Ký chủ nhân vật chính: Nhân vật chính là ký chủ của hệ thống cửa hàng, có thể tương tác với hệ thống\n' +
      'Cửa hàng hệ thống: Ký chủ có thể mua vật phẩm theo giá gốc từ cửa hàng hệ thống\n' +
      'Cấp bậc VIP: Theo số tiền mua sắm tích lũy tăng lên, cấp bậc VIP của ký chủ sẽ được nâng cao, khởi đầu là cấp 1, tối đa cấp 5\n' +
      'Quyền hạn cấp 1: Chỉ có thể mua các nhu yếu phẩm thường nhật, thực phẩm, trang phục...\n' +
      'Quyền hạn cấp 2: Có thể mua nội thất và thiết bị cỡ vừa và nhỏ...\n' +
      'Quyền hạn cấp 3: Có thể mua phương tiện di chuyển, đất đai, nhà cửa, nội thất và thiết bị cỡ lớn...\n' +
      'Quyền hạn cấp 4: Có thể mua tác phẩm nghệ thuật, trang bị quân sự, doanh nghiệp...\n' +
      'Quyền hạn cấp 5: Có thể mua bất kỳ vật phẩm nào xuyên thời không'),
    W('Hệ thống Thần Hào',
      'Ký chủ nhân vật chính: Nhân vật chính là ký chủ của hệ thống Thần Hào, có thể tương tác với hệ thống\n' +
      'Tiền tài từ trên trời rơi xuống: Định kỳ theo thời gian, hệ thống sẽ cung cấp cho ký chủ một lượng vốn hệ thống nhất định, số vốn này không được phung phí vô bổ\n' +
      'Chuyển đổi lời lỗ: Sau một khoảng thời gian sẽ tiến hành quyết toán, phần dôi dư hoặc thâm hụt so với vốn hệ thống sẽ được quy đổi thành tài sản cá nhân mà ký chủ có thể tự do định đoạt theo tỷ lệ nhất định\n' +
      'Tỷ lệ chuyển đổi: Tỷ lệ chuyển đổi phần dôi dư là 100:1, tỷ lệ chuyển đổi phần thâm hụt là 1:1'),
  ] },
  { g: 'NSFW', items: [
    W('Thế giới dâm loạn',
      'Âm hưởng thế giới: Cực độ dâm uế, không có đạo đức tình dục\n' +
      'Hành vi tình dục thường nhật hóa: Lời mời quan hệ tình dục trực diện, hành vi tình dục lộ liễu phát sinh dễ dàng, hành vi tình dục công khai phổ biến\n' +
      'Phụ nữ lăng loàn hóa: Dâm đãng và dục vọng tràn trề, bộc lộ tình dục thẳng thắn, không có sự xấu hổ tình dục, ngôn ngữ tình dục trực diện thô tục, sử dụng các từ như buồi, địt...\n' +
      'Dục vọng siêu nhiên hóa: Dục vọng áp đảo hoàn toàn thân phận và tính cách\n' +
      'Tính đặc thù của nhân vật chính: Đối tượng tình dục duy nhất được chọn, hoàn toàn ngó lơ những người đàn ông khác ngoài nhân vật chính\n' +
      'Thay đổi trọng tâm tự sự: Lấy NSFW làm cốt lõi, tập trung vào tương tác tình dục, có thể hy sinh tính hợp lý logic và sự mạch lạc tự sự\n' +
      'NSFW trực diện: Có thể chuyển thẳng sang phân cảnh NSFW mà không cần rào đón mở bài'),
    W('Thế giới NTR', 'Sức căng của thế giới nằm ở sự giằng xé giữa lòng trung thành và phản bội, đau đớn và tha thứ giữa những người yêu nhau, phụ nữ của nhân vật chính có thói quen lén lút ngoại tình, các nhân vật như hoàng mao, đại thúc, otaku béo, futanari cặc bự... sẽ cắm sừng nhân vật chính'),
    W('Tinh dịch kích dục', 'Tinh dịch của nhân vật chính sẽ thay đổi triệt để tư tưởng của những người phụ nữ từng tiếp xúc qua, họ sẽ tạm thời rơi vào trạng thái phát tình, khao khát dương vật của nhân vật chính một cách dâm loạn, sau cuộc ân ái họ sẽ hồi phục ý thức nhưng vẫn lưu giữ ký ức về khoái cảm'),
  ] },
  { g: 'Khác', items: [
    W('Renkemon',
      'Bối cảnh thế giới:\n' +
      '  - Khái quát thế giới: Nữ giới và nam giới cùng nhau cấu thành xã hội loài người tiêu chuẩn. Tất cả nữ giới bẩm sinh đều sở hữu thuộc tính "Renkemon", có thể được các huấn luyện viên nam "bắt giữ" và thiết lập mối quan hệ chủ tớ thông qua quy trình khế ước hợp pháp.\n' +
      '  - Trạng thái xã hội thường nhật:\n' +
      '    - Renkemon học tập, làm việc và sinh sống tương tự như nam giới. Mối quan hệ bắt giữ là một hình thức khế ước thân mật và lệ thuộc đặc thù được xã hội công nhận.\n' +
      '    - Tiền đề bắt giữ: Bắt buộc phải nhận được sự đồng thuận tỉnh táo và tự nguyện của chính Renkemon. Quy trình chuẩn là hai bên giao thiệp, đạt được sự đồng thuận, sau đó đến cơ quan đăng ký của Liên Minh để hoàn tất ràng buộc.\n' +
      '  - Bắt giữ cưỡng chế phi pháp (Mặt tối):\n' +
      '    - Thủ đoạn vi pháp:\n' +
      '      - Dược phẩm: Sử dụng các chất giãn thần kinh cấm, thuốc phục tùng hoặc thuốc kích dục cực mạnh khiến Renkemon rơi vào trạng thái mơ màng, suy giảm năng lực phán đoán.\n' +
      '      - Uy hiếp: Lợi dụng điểm yếu, nợ nần, đe dọa bạo lực hoặc thao túng tâm lý để ép buộc Renkemon phải đồng ý.\n' +
      '      - Trói buộc vật lý: Sử dụng "Khế ước cầu trói buộc" được cải tạo phi pháp hoặc thiết bị giam hãm, bỏ qua khâu xác nhận ý chí để cưỡng ép thu nạp.\n' +
      '      - Can thiệp ý thức: Trong trường hợp cực đoan, tồn tại các công nghệ cấm kỵ nhằm sửa đổi ký ức hoặc cấy ghép cảm xúc giả tạo (theo lời đồn).\n' +
      '    - Hậu quả và thị trường chợ đen:\n' +
      '      - Bắt giữ phi pháp là trọng tội. Một khi bị xác minh, giấy phép huấn luyện viên sẽ bị thu hồi vĩnh viễn và đối mặt với án tù giam.\n' +
      '      - Chợ đen tồn tại hoạt động giao dịch Renkemon bị bắt giữ phi pháp, lưu thông dược phẩm và thiết bị cấm. Liên Minh liên tục trấn áp, hiện đã trở nên vô cùng hiếm gặp.\n' +
      '      - Một bộ phận Renkemon bị bắt giữ phi pháp sẽ tìm cách cầu cứu ra bên ngoài hoặc trốn chạy.\n' +
      'Hệ thống phân loại Renkemon:\n' +
      '  - Loại hình chính (Dựa trên ngoại hình, khí chất và thiên hướng năng lực cốt lõi):\n' +
      '    - Dạng ấu nữ: Thường sở hữu tiềm năng tăng trưởng Tấn công Đặc biệt (Kỹ xảo / Quyến rũ) cực cao, nhưng thể lực bền bỉ và sức mạnh cơ bản rất thấp. Độ tương phản giữa ngây thơ và trưởng thành sớm rất rõ nét.\n' +
      '    - Dạng loli: Tăng trưởng năng lực tương đối cân bằng, hoặc sở hữu các kỹ năng thiên phú quấy nhiễu, trị liệu độc đáo.\n' +
      '    - Dạng thiếu nữ: Các chỉ số năng lực tăng trưởng ổn định, tốc độ học tập nhanh, thích ứng được nhiều phong cách.\n' +
      '    - Dạng ngự tỷ: Thường sở hữu Tấn công cao (năng lực chủ động vắt kiệt) và Phòng ngự cao (sức chịu đựng), giỏi kiểm soát nhịp độ.\n' +
      '    - Dạng thục nữ: Sở hữu sức bền và khả năng hồi phục cực cao, giỏi đánh lâu dài và phục vụ chuyên sâu, mang lại cảm giác an tâm.\n' +
      '  - Loại hình phụ - Thuộc tính moe thường gặp (Ảnh hưởng đến mô thức tương tác, cây kỹ năng và phản hồi cảm xúc):\n' +
      '    - Tsundere: Ngoài lạnh trong nóng, khi phục vụ mang theo sự săn sóc vụng về và những pha bộc trực bất ngờ.\n' +
      '    - Kuudere: Biểu hiện cảm xúc mờ nhạt, hành động chuẩn xác hiệu quả, phản hồi trực diện.\n' +
      '    - Yandere: Độc chiếm dục và chấp niệm chuyển hóa thành nhiệt huyết phục vụ mãnh liệt và ham muốn kiểm soát.\n' +
      '    - Genki: Cởi mở chủ động, giỏi khuấy động bầu không khí, kỹ năng thường mang hiệu ứng cổ vũ.\n' +
      '    - Yamato Nadeshiko: Thuần phong dịu dàng, chú trọng lễ nghi và phục vụ chu đáo.\n' +
      '    - Gyaru: Thời thượng phóng khoáng, thế công trực diện mãnh liệt.\n' +
      '    - Thiếu nữ văn học: Tinh tế nhạy cảm, trong phục vụ chứa đựng sự giao lưu và trêu chọc ở tầng thứ tinh thần.\n' +
      '    - Thanh mai trúc mã: Cảm giác tin cậy sâu sắc, dễ dàng đạt được sự ăn ý, điều kiện xuất kỹ năng phối hợp thoải mái.\n' +
      '    - Tennen-boke: Phản ứng chậm chạp, cử chỉ ngớ ngẩn, thường có những pha bộc trực ngoài dự liệu hoặc hành động phá cách.\n' +
      '    - Vụng về đáng yêu: Tay chân lóng ngóng nhưng nỗ lực, dễ gây ra "sự cố" ngoài ý muốn, đem lại kích thích mới lạ.\n' +
      '    - Bụng dạ đen tối: Bề ngoài ôn hòa thân thiện, bên trong giỏi toan tính và dẫn dắt, tận hưởng quá trình kiểm soát ngầm.\n' +
      '    - Độc thiệt: Lời lẽ sắc bén, thích cà khịa và công kích bằng ngôn từ, nhưng có thể phát huy tác dụng theo cách khích tướng.\n' +
      '    - Nữ vương: Khí chất cao ngạo, quen thói chủ đạo và hạ lệnh, tư thế phục vụ cũng tràn ngập cảm giác chi phối.\n' +
      '    - Thần tượng: Quen thể hiện hình tượng hoàn mỹ, giỏi biểu diễn và tạo cảm giác mộng ảo, phục vụ tựa như diễn xuất trên sân khấu.\n' +
      '    - Hầu gái: Coi việc phục vụ là thiên chức và danh dự, theo đuổi quy chuẩn tối thượng và sự chu đáo.\n' +
      '    - Kemomimi: Mang đặc trưng động vật (tai, đuôi...), bản năng mãnh liệt, mô thức hành vi trực diện hơn hoặc mang tính hoang dã.\n' +
      '    - Ma nữ: Mang theo cảm giác huyền bí, có thể nắm giữ một số kỹ xảo đặc thù phá cách tương tự ma pháp hoặc kiến thức về dược tễ.\n' +
      '    - Bệnh nhược: Thể chất suy nhược, dễ mệt mỏi, nhưng nhờ đó có thể khơi dậy ham muốn bảo vệ hoặc tạo ra sự kiên cường tương phản.\n' +
      '    - Thiếu nữ thể thao: Thể lực dồi dào, sự phối hợp cơ thể tốt, giỏi các động tác độ khó cao đòi hỏi kết hợp giữa thể lực và kỹ xảo.\n' +
      '    - Otaku nữ: Có kiến thức sâu rộng về lĩnh vực đặc định (như ACG), có thể lồng ghép sở thích otaku vào phục vụ hoặc làm chủ đề trò chuyện.\n' +
      '    - Chuunibyou: Đắm chìm trong thiết lập hão huyền, lời nói hành động khoa trương, phục vụ có thể mang đậm yếu tố kịch tính và nhập vai.\n' +
      'Hệ thống thực lực vắt kiệt:\n' +
      '  - Năng lực 6 chiều (Xoay quanh tình dục):\n' +
      '    - Lực mút: Cường độ kỹ xảo liên quan đến miệng, lưỡi, ngực.\n' +
      '    - Độ khít: Lực co bóp và khả năng kiểm soát của âm đạo / hậu môn.\n' +
      '    - Độ dẻo dai: Khả năng uốn dẻo của cơ thể, ảnh hưởng đến tư thế và phạm vi thi triển kỹ năng.\n' +
      '    - Lực bền bỉ: Thể lực và sức chịu đựng trong các hoạt động tình dục.\n' +
      '    - Chỉ số kỹ xảo: Độ rộng, độ sâu và tính sáng tạo trong việc nắm vững các kỹ thuật tình dục.\n' +
      '    - Mê hoặc lực: Năng lực vận dụng tổng hợp ngoại hình, âm thanh, khí chất để tấn công tinh thần.\n' +
      '  - Cốt lõi chiến đấu phụng nạp:\n' +
      '    - Mục tiêu: Khiến huấn luyện viên / đối thủ xuất tinh trong tình huống quy định và theo đuổi "Đánh giá tinh hoa" cao hơn.\n' +
      '    - Đánh giá tinh hoa: Được quyết định bởi lượng xuất ra, độ đậm đặc, biểu hiện tổng hợp lúc xuất ra (kỹ xảo, đầu tư cảm xúc, trạng thái đối thủ).\n' +
      '  - Kỹ năng và thiên phú:\n' +
      '    - Kỹ năng: Tiêu hao khí lực để phát động, tạo ra kích thích trực tiếp, kèm theo trạng thái hoặc hiệu ứng sân bãi.\n' +
      '    - Thiên phú loại hình: Mỗi loại hình chính sở hữu một nhánh thiên phú bị động độc nhất, duy trì hiệu lực xuyên suốt trong chiến đấu phụng nạp (như "Quyến rũ thuần khiết" của dạng ấu nữ - giảm nhẹ toàn bộ kháng tính của đối thủ; "Nuôi dưỡng căng tràn" của dạng thục nữ - tăng nhẹ tốc độ hồi phục sức bền của bản thân).\n' +
      'Bắt giữ và bồi dưỡng:\n' +
      '  - Quy trình bắt giữ hợp pháp:\n' +
      '    - Tiền đề: Huấn luyện viên cần sở hữu giấy phép hợp lệ.\n' +
      '    - Đồng thuận: Hai bên đạt được ý định ràng buộc.\n' +
      '    - Đăng ký: Tại cơ quan Liên Minh, sử dụng "Khế ước cầu" chính thức để hoàn tất ràng buộc thân phận và nhập thông tin. Khế ước cầu tích hợp hệ thống nhận diện, đảm bảo hai bên đều tỉnh táo và xác nhận.\n' +
      '  - Huấn luyện viên:\n' +
      '    - Giấy phép: Đạt được thông qua kỳ sát hạch của Liên Minh (đạo đức, tri thức, tài chính cơ bản).\n' +
      '    - Tài nguyên cốt lõi: "Tinh lực" và "Tài lực". Cần phân bổ hợp lý để duy trì việc bồi dưỡng Renkemon và trạng thái của bản thân.\n' +
      '  - Pokédex:\n' +
      '    - Kiểu dáng: Thiết bị điện tử có dạng máy tính bảng, tích hợp camera và màn hình hiển thị\n' +
      '    - Chức năng: Sau khi quét Renkemon, sẽ hiển thị loại hình và giới thiệu về Renkemon đó, cùng với năng lực 6 chiều\n' +
      '  - Độ thân mật và trưởng thành:\n' +
      '    - Thăng cấp: Cùng chung sống, phụng nạp thành công, tặng quà, thỏa mãn nguyện vọng.\n' +
      '    - Hiệu quả: Độ thân mật cao mở khóa kỹ năng ẩn, nâng cao hiệu suất tăng trưởng năng lực, có thể kích hoạt sự kiện tiến hóa / thức tỉnh đặc thù.\n' +
      'Liên Minh và cơ sở hạ tầng xã hội:\n' +
      '  - Liên Minh Renkemon: Lập pháp, giám sát, tổ chức giải đấu, quản lý đăng ký, trấn áp hoạt động phi pháp.\n' +
      '  - Trung tâm đăng ký / công chứng: Xử lý mọi sự vụ khế ước hợp pháp.\n' +
      '  - Đấu trường phụng nạp: Tổ chức các giải đấu ở mọi cấp bậc.\n' +
      '  - Nhà bồi dưỡng: Gửi nuôi, quản lý sức khỏe, huấn luyện cơ bản, ghép đôi mai mối.\n' +
      '  - Học viện kỹ năng: Truyền thụ các kỹ xảo vắt kiệt đặc định.\n' +
      '  - Viện giám định tinh hoa: Giám định uy tín đối với sản phẩm phụng nạp xuất ra.\n' +
      '  - (Tối) Chợ đen: Nơi tụ tập các giao dịch phi pháp, lưu thông hàng cấm và Renkemon bị bắt giữ trái phép.\n' +
      'Luân chuyển trạng thái:\n' +
      '  - Thân phận xã hội của Renkemon:\n' +
      '    - Người tự do\n' +
      '    - Giai đoạn tìm hiểu (đang tiếp xúc)\n' +
      '    - Đang trong khế ước\n' +
      '    - Giai đoạn dưỡng sức (mang thai, thương tật...)\n' +
      '    - Hủy khế ước / giải nghệ\n' +
      '  - Trạng thái cơ thể đặc thù:\n' +
      '    - Kỳ phát tình (năng lực biến động, nhu cầu tăng cao)\n' +
      '    - Kỳ thai nghén (năng lực biến đổi, cấm thi đấu)\n' +
      '    - Kỳ cho con bú (năng lực liên quan đến Tấn công Đặc biệt tăng cao)'),
  ] },
];

const PERS_PRESETS = [];

function persPresetBtnsHtml() {
  if (!PERS_PRESETS.length) return '<span class="eye-ptags-empty">Tạm thời chưa có preset</span>';
  return PERS_PRESETS.map(gr =>
    '<div class="eye-pgroup">' +
      '<span class="eye-pgroup-t">' + esc(gr.g) + '</span>' +
      '<div class="eye-ptags">' + gr.items.map(p =>
        '<span class="dg-eye-btn" data-wpre="' + esc(p.c) + '" data-wpt="" title="' + esc(p.c) + '">' +
          esc(shorten(p.c)) + '</span>'
      ).join('') + '</div>' +
    '</div>'
  ).join('');
}

function viewBlocked(view) {
  const m = modsMap();
  if (view === 'record' || view === 'file') return !m.mon;
  if (view === 'cmd') return !m.cmd;
  if (view === 'world' || view === 'gen') return !m.set;
  return false;
}

function syncHexNodes() {
  doc.querySelectorAll('.dg-hex-node[data-act]').forEach(n => {
    n.classList.toggle('off', viewBlocked(n.getAttribute('data-act')));
  });
}

function openView(view) {
  const panel = doc.getElementById('dg-eye-panel');
  const ball = doc.getElementById('dg-eye-ball');
  if (!panel) return;
  if (viewBlocked(view)) {
    const nm = (view === 'record' || view === 'file') ? 'Giám sát' : (view === 'cmd' ? 'Chỉ thị' : 'Thiết lập');
    tip('"' + nm + '" đã tắt, có thể bật lại trong Cài đặt', true);
    return;
  }
  PANEL_VIEW = view;
  MON_PAGE = 1;
  panel.style.display = 'flex';
  const t = panel.querySelector('.hd .t');
  if (t) t.innerHTML = titleHtml(view);
  if (ball) placePanel(ball, panel);
  renderPanel();
}

function viewKind() {
  if (PANEL_VIEW === 'world') return SET_TAB === 'pers' ? 'pers' : 'world';
  return 'mon';
}

async function renderPanel() {
  const panel = doc.getElementById('dg-eye-panel');
  if (!panel) return;
  if (viewBlocked(PANEL_VIEW)) PANEL_VIEW = 'set';
  const bd = panel.querySelector('.bd');

  const card = currentCharName();
  let wb = null;
  let wbErr = '';
  try {
    wb = await getWorldbook(WB_NAME);
    if (!Array.isArray(wb)) throw new Error('missing');
  } catch (e) {
    wb = [];
    wbErr = 'Không đọc được Worldbook "' + WB_NAME + '"';
  }

  const mslots = await readSlots('mon', wb);
  const list = await loadList(card, 'mon', mslots);
  WATCH_CACHE = list.names;
  const watch = list.names;

  let html;
  if (PANEL_VIEW === 'cmd') {
    html = viewCommandHtml(watch);
  } else if (PANEL_VIEW === 'world') {
    const kind = viewKind();
    const sslots = await readSlots(kind, wb);
    const slist = await loadList(card, kind, sslots);
    const sentries = slotsOfCard(sslots, card, kind);
    html = kind === 'pers'
      ? viewPersHtml(slist.names, card, slist, wbErr, sentries, watch, slist.blocks)
      : viewWorldHtml(slist.names, card, slist, wbErr, sentries, slist.blocks);
  } else if (PANEL_VIEW === 'gen') {
    html = viewGenHtml();
  } else if (PANEL_VIEW === 'file') {
    html = viewFileHtml(watch);
  } else if (PANEL_VIEW === 'help') {
    html = viewHelpHtml();
  } else if (PANEL_VIEW === 'set') {
    html = viewSetHtml(wb);
  } else {
    html = viewRecordHtml(watch, card, list, wbErr, slotsOfCard(mslots, card, 'mon'));
  }

  bd.innerHTML = html;
  bindPanel();
  if (LOOSE) { LOOSE = false; tip('Có mục bị nhảy cấp thụt lề, đã được gom về cấp liền trước'); }
}

function viewRecordHtml(watch, card, list, wbErr, entries) {
  return '<section class="eye-sec">' +
      '<div class="eye-sec-h"><span class="eye-sec-t">Mục danh sách</span><span class="eye-spacer"></span>' +
        (card ? '<span class="eye-card-tag" title="' + esc(card) + '">' + esc(card) + '</span>' : '') +
      '</div>' +
      slotRowHtml(entries, list && list.name, 'mon') +
      '<div class="eye-sec-h"><span class="eye-sec-t">Đối tượng giám sát</span>' +
        '<span class="eye-count">' + watch.length + '</span>' +
        '<span class="eye-spacer"></span>' +
      '</div>' +
      membersHtml(watch, card) +
      '<div class="eye-add">' +
        '<input id="eye-new" placeholder="Tên nhân vật trong thẻ này" maxlength="40">' +
        '<span class="dg-eye-btn pri" id="eye-add">Thêm</span>' +
      '</div>' +
      '<div class="dg-eye-msg">' + esc(wbErr) + '</div>' +
    '</section>';
}

function kindWord(kind) {
  return kind === 'world' ? 'Thiết lập thế giới' : kind === 'pers' ? 'Thiết lập nhân vật' : 'Danh sách';
}

function slotRowHtml(entries, activeName, kind) {
  const has = !!(entries && entries.length);
  const word = kindWord(kind);
  const newTip = 'Tạo mới một mục ' + word + ' trống';
  const opts = has ? entries.map(s => {
    const nm = slotName(s);
    return '<option value="' + esc(nm) + '"' + (nm === activeName ? ' selected' : '') + '>' +
      esc(nm) + '</option>';
  }).join('') : '';
  return '<div class="eye-slotrow">' +
      (has ? '<select id="eye-slot">' + opts + '</select>' +
             '<span class="eye-m-ic" id="eye-slot-new" title="' + newTip + '">' + IC_PLUS + '</span>' +
             '<span class="eye-m-ic" id="eye-slot-ren" title="Đổi số thứ tự mục">' + IC_PEN + '</span>' +
             '<span class="eye-m-ic danger" id="eye-slot-del" title="Xóa mục">' + IC_X + '</span>'
           : '<span class="eye-slot-empty">Chưa có mục ' + word + '</span>' +
             '<span class="eye-m-ic" id="eye-slot-new" title="' + newTip + '">' + IC_PLUS + '</span>') +
    '</div>';
}

function membersHtml(watch, card) {
  if (!watch.length) {
    return '<div class="eye-empty" style="margin-bottom:10px">' +
        '<div class="eye-empty-ico"></div>' +
        '<div class="eye-empty-t">Chưa có danh sách giám sát</div>' +
        '<div class="eye-empty-s">Nhập tên nhân vật bên dưới để đưa vào giám sát</div>' +
      '</div>';
  }
  return '<div class="eye-members">' + watch.map(nm =>
    '<div class="eye-member' + (MON_SEL === nm ? ' sel' : '') + '">' +
      '<span class="eye-dot"></span>' +
      '<span class="eye-m-name" title="' + esc(nm) + '">' + esc(nm) + '</span>' +
      '<span class="eye-m-ic" data-eye="' + esc(nm) + '" title="Xem trong hồ sơ">' + IC_EYE + '</span>' +
      '<span class="eye-m-ic" data-pen="' + esc(nm) + '" title="Đổi tên">' + IC_PEN + '</span>' +
      '<span class="eye-m-ic danger" data-x="' + esc(nm) + '" title="Xóa khỏi danh sách">' + IC_X + '</span>' +
    '</div>'
  ).join('') + '</div>';
}

function presetBtnsHtml(tab) {
  return (PRESETS[tab] || []).map(p =>
    '<span class="dg-eye-btn" data-pre="' + esc(p.tx) + '" title="' + esc(p.tx) + '">' +
      esc(shorten(p.lb)) + '</span>'
  ).join('');
}

/* Tên nhóm của thiết lập thế giới mặc định không nhất thiết phải là tiêu đề lớn: 4 thể loại mặc định lấy theo tên nhóm,
   còn "Khác" chỉ là phân loại loại trừ ở frontend chứ không phải tiêu đề lớn, các mục dạng này dùng tiêu đề riêng của nó.
   Trong Worldbook sẽ không xuất hiện thẻ "Khác". */
function presetHead(grp, wpt) {
  const g = String(grp == null ? '' : grp).trim();
  return BLOCK_HEADS.indexOf(g) >= 0 ? g : String(wpt == null ? '' : wpt).trim();
}

function worldPresetBtnsHtml() {
  return WORLD_PRESETS.map(gr =>
    '<div class="eye-pgroup">' +
      '<span class="eye-pgroup-t">' + esc(gr.g) + '</span>' +
      '<div class="eye-ptags">' + gr.items.map(p =>
        '<span class="dg-eye-btn" data-wpre="' + esc(p.c) + '" data-wpt="' + esc(p.t) + '" data-wpg="' + esc(gr.g) + '" title="' +
          esc(p.t ? p.t + ': ' + p.c : p.c) + '">' + esc(shorten(p.t || p.c)) + '</span>'
      ).join('') + '</div>' +
    '</div>'
  ).join('');
}

function objInputHtml(id, cur, cands, tag, label) {
  const chips = cands.length
    ? '<div class="eye-pbar">' + cands.map(nm =>
        '<span class="eye-pchip' + (nm === cur ? ' on' : '') + '" ' + tag + '="' + esc(nm) + '">' +
          esc(nm) + '</span>'
      ).join('') + '</div>'
    : '';
  return '<div class="eye-field"><span class="eye-lb">' + esc(label || 'Đối tượng') + '</span>' +
      '<div class="eye-cmd-row">' +
        '<input id="' + id + '" maxlength="40" value="' + esc(cur) + '" placeholder="Tên đối tượng, có thể nhập trực tiếp">' +
      '</div>' +
    '</div>' + chips;
}

function cmdObjName(watch) {
  if (CMD_OBJ != null && CMD_OBJ_CARD === currentCharName()) return CMD_OBJ;
  if (PENDING_CMD && PENDING_CMD.name) return PENDING_CMD.name;
  return watch[0] || '';
}

function targetFieldHtml(watch) {
  return objInputHtml('eye-target', cmdObjName(watch), watch, 'data-cobj');
}

function cmdInputHtml(group) {
  return '<div class="eye-frow">' +
      '<textarea id="eye-cmd" class="eye-ta" placeholder="Tùy chỉnh ' + group + ' (có thể nhấn vào mục phía trên để điền vào)"></textarea>' +
      '<div class="eye-fbtns">' +
        '<span class="dg-eye-btn" id="eye-save">Lưu</span>' +
        '<span class="dg-eye-btn pri" id="eye-send">Gửi</span>' +
      '</div>' +
    '</div>' +
    '<div class="dg-eye-msg"></div>';
}

function viewCommandHtml(watch) {
  const tab = CMD_TAB;
  const customs = customsOf(currentCharName(), 'Chỉ thị');
  const tabs = CMD_TABS.map(t =>
    '<span class="eye-tab' + (t === tab ? ' on' : '') + '" data-tab="' + esc(t) + '">' + esc(t) + '</span>'
  ).join('');
  return '<section class="eye-sec eye-cmd" data-kind="' + esc(tab) + '">' +
      targetFieldHtml(watch) +
      '<div class="eye-tabs" id="eye-tabs">' + tabs + '</div>' +
      foldHtml('preset', tab + ' mặc định', -1,
        '<div class="eye-ptags" id="eye-presets">' + presetBtnsHtml(tab) + '</div>') +
      foldHtml('custom', 'Mục tùy chỉnh', customs.length,
        '<div class="eye-chips" id="eye-chips">' + chipsHtml(customs) + '</div>') +
      cmdInputHtml('Chỉ thị') +
    '</section>';
}

/* Nút cây bút ở góc trên bên phải trang Thiết lập: Nhấp mở trang "Tạo thiết lập" */
function penIconHtml() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<defs>' +
      '<linearGradient id="eye-pen-g" x1="10.05" y1="0.8" x2="13.95" y2="18.4" gradientUnits="userSpaceOnUse">' +
        '<stop offset="0" stop-color="#523c22"/>' +
        '<stop offset=".52" stop-color="#7e5c2c"/>' +
        '<stop offset="1" stop-color="#a2803c"/>' +
      '</linearGradient>' +
      '<linearGradient id="eye-pen-n" x1="10.05" y1="18.2" x2="13.95" y2="25.4" gradientUnits="userSpaceOnUse">' +
        '<stop offset="0" stop-color="#ffeec2"/>' +
        '<stop offset=".48" stop-color="#e5b962"/>' +
        '<stop offset="1" stop-color="#a1721f"/>' +
      '</linearGradient>' +
    '</defs>' +
    '<g transform="rotate(45 12 12)">' +
      '<rect x="10.05" y="0.8" width="3.9" height="17.1" rx="1.05" fill="url(#eye-pen-g)"/>' +
      '<rect x="10.45" y="2.2" width="1.25" height="13.9" rx=".62" fill="#fff8e6" fill-opacity=".3"/>' +
      '<rect x="10.05" y="1.45" width="3.9" height=".7" fill="#1e1508" fill-opacity=".3"/>' +
      '<rect x="14.1" y="1.3" width="1.6" height="6.4" rx=".8" fill="#2b1e0c"/>' +
      '<rect x="14.35" y="1.9" width=".5" height="5.2" rx=".25" fill="#ffe9c0" fill-opacity=".38"/>' +
      '<rect x="10.05" y="3.4" width="3.9" height=".42" fill="#cfa757" fill-opacity=".85"/>' +
      '<rect x="10.05" y="4.15" width="3.9" height=".42" fill="#cfa757" fill-opacity=".55"/>' +
      '<rect x="10.05" y="16.25" width="3.9" height="1.2" fill="#cfa757"/>' +
      '<rect x="10.05" y="16.25" width="3.9" height=".42" fill="#ffeec2" fill-opacity=".6"/>' +
      '<rect x="10.05" y="17.15" width="3.9" height=".35" fill="#241a08" fill-opacity=".45"/>' +
      '<path d="M10.05 17.85h3.9l-1.2 5.55L12 25.7l-.75-2.3z" fill="url(#eye-pen-n)"/>' +
      '<path d="M12 18.3v6.9" stroke="#3a2a0c" stroke-width=".85" stroke-opacity=".6" stroke-linecap="round"/>' +
      '<path d="M10.3 18.05h1.15l-1 4.35-.55-1.6z" fill="#fffdf2" fill-opacity=".5"/>' +
    '</g>' +
    '</svg>';
}

function setTabsHtml() {
  return '<div class="eye-set-top">' +
    '<div class="eye-tabs" id="eye-stabs">' +
    '<span class="eye-tab' + (SET_TAB === 'world' ? ' on' : '') + '" data-stab="world">Thiết lập thế giới</span>' +
    '<span class="eye-tab' + (SET_TAB === 'pers' ? ' on' : '') + '" data-stab="pers">Thiết lập nhân vật</span>' +
    '</div>' +
    '<span class="eye-pen" id="eye-gen-open" title="Tạo thiết lập">' + penIconHtml() + '</span>' +
    '</div>';
}

/* 5 tùy chọn của trang Tạo thiết lập: Tên nhập đến đâu nhớ đến đó, 4 phân cấp có menu thả xuống riêng.
   Chỉ tồn tại trong trang này, chuyển đi rồi quay lại vẫn còn. */
const GEN_OPTS = { name: '', kind: 'Thiết lập thế giới', scope: 'Chung', nsfw: 'Không liên quan', fsm: 'Bật' };

function genSelHtml(id, vals, cur, lockVal) {
  const opts = vals.map(v =>
    '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') +
    (!!lockVal && v === lockVal ? ' disabled' : '') + '>' + esc(v) + '</option>').join('');
  return '<span class="eye-gen-sel"><select id="' + id + '">' + opts + '</select></span>';
}

function genOptsHtml() {
  return '<div class="eye-gen-opts"><div class="eye-gen-opt">' +
      '<span class="eye-gen-lb">Tên thiết lập</span>' +
      '<span class="eye-gen-lb">Loại thiết lập</span>' +
      '<span class="eye-gen-lb">Phạm vi thiết lập</span>' +
      '<span class="eye-gen-lb">Thiết lập NSFW</span>' +
      '<span class="eye-gen-lb">State machine</span>' +
      '<input id="eye-gen-name" placeholder="Có thể để trống" value="' + esc(GEN_OPTS.name) + '">' +
      genSelHtml('eye-gen-kind', ['Thiết lập thế giới', 'Thiết lập nhân vật'], GEN_OPTS.kind, 'Thiết lập nhân vật') +
      genSelHtml('eye-gen-scope', ['Chung', 'Chuyên dụng'], GEN_OPTS.scope, '') +
      genSelHtml('eye-gen-nsfw', ['Không liên quan', 'Có liên quan', 'Lộ liễu', 'Thuần túy'], GEN_OPTS.nsfw, '') +
      genSelHtml('eye-gen-fsm', ['Bật', 'Tắt'], GEN_OPTS.fsm, '') +
    '</div></div>';
}

function viewGenHtml() {
  return '<section class="eye-sec">' +
      '<div class="eye-gen-h">' +
        '<span class="eye-sec-t">Hướng dẫn sử dụng</span>' +
        '<span class="eye-spacer"></span>' +
        '<span class="eye-hbtn" id="eye-gen-back">Quay lại Thiết lập</span>' +
      '</div>' +
      '<div class="eye-gen-note">' +
        '<p>Sau khi nhập yêu cầu của bạn, AI sẽ tuân theo các thiết lập định dạng sáng tác liên quan, phân tích yêu cầu theo 8 bước quy định để tạo ra thiết lập. Hiện tại tính năng này chỉ hỗ trợ tạo Thiết lập thế giới, chưa tương thích cho việc tạo Thiết lập nhân vật.</p>' +
        '<ul>' +
          '<li>Định nghĩa và chức năng rõ ràng: Việc thiết kế định nghĩa và chức năng rõ ràng sẽ giúp AI tạo đúng văn bản thiết lập bạn mong muốn</li>' +
          '<li>Tự động tạo state machine: AI sẽ căn cứ theo yêu cầu của bạn để tự động tạo hệ thống state machine theo từng giai đoạn, điều kiện cụ thể</li>' +
          '<li>Mức độ NSFW: Chia làm 4 cấp độ từ thấp đến cao gồm: ① Không liên quan (tức thiết lập thuần SFW), ② Có liên quan (tức thiết lập chứa nội dung NSFW), ③ Lộ liễu (tức thiết lập chứa nội dung NSFW mức độ nặng), ④ Thuần túy (tức thiết lập thuần NSFW)</li>' +
          '<li>Đặt tên thiết lập: Vui lòng đặt một cái tên cho thiết lập bạn cần, nếu chưa đặt tên, AI sẽ tạm thời thay bằng placeholder giữ chỗ</li>' +
          '<li>Nguyên lý hoạt động: Sau khi nhấn gửi, hệ thống sẽ gửi yêu cầu của bạn cho AI để AI tạo văn bản thiết lập theo khung tích hợp sẵn</li>' +
          '<li>Kết quả đầu ra: Khi nhận được yêu cầu, AI sẽ xuất văn bản thiết lập YAML được bọc trong các thẻ tag, có thể nhấn nút sao chép ở góc trên bên phải khối code rồi dán vào ô "Nội dung" trong giao diện Thiết lập thế giới để hệ thống tự động bóc tách import</li>' +
        '</ul>' +
      '</div>' +
      genOptsHtml() +
      '<div class="eye-add eye-gen-row">' +
        '<input id="eye-gen-text" placeholder="Ghi rõ yêu cầu thiết lập bạn muốn tạo">' +
        '<span class="dg-eye-btn pri eye-gen-send" id="eye-gen-send">Gửi</span>' +
      '</div>' +
      '<div class="dg-eye-msg"></div>' +
    '</section>';
}

function viewWorldHtml(items, card, list, wbErr, entries, blocks) {
  const compOn = COMP_OPEN && COMP_KIND === 'world';
  const cur = String(WORLD_HEAD || '').trim() || (list && list.head) || 'Thế giới quan';
  const flat = (list && list.flat) || [];
  const cands = [];
  BLOCK_HEADS.concat(blockHeads(blocks)).forEach(h => { if (h && cands.indexOf(h) < 0) cands.push(h); });
  return '<section class="eye-sec">' + setTabsHtml() +
      objInputHtml('eye-world-head', cur, cands, 'data-whead', 'Tiêu đề lớn') +
      '<div class="eye-sec-h"><span class="eye-sec-t">Mục thiết lập thế giới</span><span class="eye-spacer"></span>' +
        (card ? '<span class="eye-card-tag" title="' + esc(card) + '">' + esc(card) + '</span>' : '') +
      '</div>' +
      slotRowHtml(entries, list && list.name, 'world') +
      foldHtml('wpreset', 'Thiết lập thế giới mặc định', -1,
          '<div id="eye-wpresets">' + worldPresetBtnsHtml() + '</div>') +
      foldHtml('wcustom', 'Mục tùy chỉnh', customsOf(currentCharName(), 'Thiết lập thế giới').length,
          '<div class="eye-chips" id="eye-chips-set" data-group="Thiết lập thế giới">' +
            chipsHtml(customsOf(currentCharName(), 'Thiết lập thế giới')) + '</div>') +
      '<div class="eye-sec-h"><span class="eye-sec-t">Kích hoạt</span>' +
        '<span class="eye-count">' + countEntries(flat) + '</span>' +
        '<span class="eye-spacer"></span>' +
        '<span class="eye-hbtn' + (compOn ? ' on' : '') + '" id="eye-comp" title="Mục phức hợp nhiều tầng">' +
          (compOn ? 'Thu gọn' : 'Phức hợp') + '</span>' +
      '</div>' +
      (compOn ? compEditorHtml() : '') +
      worldItemsHtml(flat, cur) +
      (compOn ? '' :
        '<div class="eye-add eye-add2">' +
          '<input id="eye-new-t" placeholder="Tiêu đề (có thể để trống)" maxlength="24">' +
          '<input id="eye-new" placeholder="Nội dung">' +
          '<span class="dg-eye-btn" id="eye-save">Lưu</span>' +
          '<span class="dg-eye-btn pri" id="eye-add">Thêm</span>' +
        '</div>') +
      '<div class="dg-eye-msg">' + esc(wbErr) + '</div>' +
    '</section>';
}

function persObjs(watch, blocks) {
  const out = [];
  const push = n => { if (n && out.indexOf(n) < 0) out.push(n); };
  (watch || []).forEach(push);
  blockHeads(blocks).forEach(push);
  return out;
}

function persItemsHtml(items) {
  if (!items.length) {
    return '<div class="eye-empty" style="margin-bottom:10px">' +
        '<div class="eye-empty-ico"></div>' +
        '<div class="eye-empty-t">Chưa có sửa đổi thiết lập nhân vật</div>' +
        '<div class="eye-empty-s">Hãy viết phần muốn sửa đổi vào bên dưới</div>' +
      '</div>';
  }
  return '<div class="eye-members">' +
    itemTree(items).map(n => treeRowHtml(n, '')).join('') +
    '</div>';
}

function viewPersHtml(items, card, list, wbErr, entries, watch, blocks) {
  const objs = persObjs(watch, blocks);
  if (PERS_CARD !== card) {
    PERS_CARD = card;
    if (objs.indexOf(MON_SEL) < 0) MON_SEL = objs[0] || '';
  }
  const cur = String(MON_SEL || '').trim() || (list && list.head) || '';
  const compOn = COMP_OPEN && COMP_KIND === 'pers';
  return '<section class="eye-sec">' + setTabsHtml() +
      objInputHtml('eye-pers-target', cur, objs, 'data-pobj') +
      '<div class="eye-sec-h"><span class="eye-sec-t">Mục thiết lập nhân vật</span><span class="eye-spacer"></span>' +
        (card ? '<span class="eye-card-tag" title="' + esc(card) + '">' + esc(card) + '</span>' : '') +
      '</div>' +
      slotRowHtml(entries, list && list.name, 'pers') +
      foldHtml('pperset', 'Thiết lập nhân vật mặc định', -1,
          '<div id="eye-ppersets">' + persPresetBtnsHtml() + '</div>') +
      foldHtml('pcustom', 'Mục tùy chỉnh', customsOf(currentCharName(), 'Thiết lập nhân vật').length,
          '<div class="eye-chips" id="eye-chips-set" data-group="Thiết lập nhân vật">' +
            chipsHtml(customsOf(currentCharName(), 'Thiết lập nhân vật')) + '</div>') +
      '<div class="eye-sec-h"><span class="eye-sec-t">Kích hoạt</span>' +
        '<span class="eye-count">' + items.length + '</span>' +
        '<span class="eye-spacer"></span>' +
        '<span class="eye-hbtn' + (compOn ? ' on' : '') + '" id="eye-comp" title="Mục phức hợp nhiều tầng">' +
          (compOn ? 'Thu gọn' : 'Phức hợp') + '</span>' +
      '</div>' +
      (compOn ? compEditorHtml() : '') +
      persItemsHtml(items) +
      (compOn ? '' :
        '<div class="eye-add">' +
          '<input id="eye-new" placeholder="' +
            (cur ? 'Ghi phần sửa đổi cho "' + esc(cur) + '"' : 'Điền tên đối tượng phía trên trước, rồi viết sửa đổi') + '">' +
          '<span class="dg-eye-btn" id="eye-save">Lưu</span>' +
          '<span class="dg-eye-btn pri" id="eye-add">Thêm</span>' +
        '</div>') +
      '<div class="dg-eye-msg">' + esc(wbErr) + '</div>' +
    '</section>';
}

function itemNameHtml(raw, strip) {
  const it = splitItem(raw);
  if (!it.title || (strip && it.title === strip)) {
    return '<span class="eye-m-name" title="' + esc(it.text) + '">' + esc(it.text) + '</span>';
  }
  return '<span class="eye-m-name" title="' + esc(raw) + '">' +
    '<b class="eye-m-tag">' + esc(it.title) + '</b>' + esc(it.text) + '</span>';
}

const TREE_SHUT = {};

function itemTree(items) {
  const roots = [];
  const stack = [];
  items.forEach((raw, i) => {
    const node = { raw: raw, idx: i, depth: itemDepth(raw), kids: [] };
    while (stack.length > node.depth) stack.pop();
    if (stack.length) stack[stack.length - 1].kids.push(node);
    else roots.push(node);
    stack.push(node);
  });
  return roots;
}

function treeRowHtml(n, strip, noRow) {
  const head = splitHead(n.raw);
  const kids = n.kids;
  const has = kids.length > 0;
  const cnt = has ? countKidsContent(n) : 0;
  const shut = !!(has && TREE_SHUT[n.raw]);
  return '<div class="eye-member eye-node' + (has ? ' eye-grp' : '') + '">' +
      '<span class="eye-ico">' +
        (has
          ? '<span class="eye-ar' + (shut ? '' : ' on') + '" data-tog title="Mở rộng hoặc thu gọn mục con"></span>'
          : '<span class="eye-dot"></span>') +
      '</span>' +
      (n.head ? '<span class="eye-blk" title="Tiêu đề lớn: ' + esc(n.head) + '">' + esc(n.head) + '</span>' : '') +
      (head ? '<span class="eye-m-name" title="' + esc(n.raw) + '"><b class="eye-m-tag">' + esc(head) + '</b></span>'
            : itemNameHtml(n.raw, strip)) +
      (has ? (cnt ? '<span class="eye-count">' + cnt + '</span>' : '') + '<span class="eye-sp"></span>' : '') +
      (n.depth === 0 && !noRow && viewKind() === 'world' ? '<span class="eye-m-ic" data-bmk="' + n.idx + '" title="Lưu thành mục Thiết lập thế giới tùy chỉnh">' + IC_BOOK + '</span>' : '') +
      (n.depth === 0 && !noRow ? '<span class="eye-m-ic" data-snd="' + esc(n.raw) + '" title="Nối mục này vào thanh nhập chat">' + IC_SEND + '</span>' : '') +
      '<span class="eye-m-ic" data-pen="' + esc(n.raw) + '" data-i="' + n.idx + '" title="Sửa">' + IC_PEN + '</span>' +
      '<span class="eye-m-ic danger" data-x="' + esc(n.raw) + '" data-i="' + n.idx + '" title="Xóa">' + IC_X + '</span>' +
    '</div>' +
    (has ? '<div class="eye-kids"' + (shut ? ' data-shut="1"' : '') + '>' +
      kids.map(k => treeRowHtml(k, strip, noRow)).join('') + '</div>' : '');
}

let LAST_FLAT = [];
let BLOCK_SHUT = {};

/* Các khối không phải tiêu đề lớn mặc định sẽ chiếm riêng một dòng ở ngoài cùng của cây, nút bookmark và gửi đều gắn trên dòng này */
function blockRowHtml(head, cnt) {
  const shut = !!BLOCK_SHUT[head];
  return '<div class="eye-member eye-node eye-grp eye-broot">' +
      '<span class="eye-ico"><span class="eye-ar' + (shut ? '' : ' on') + '" data-btog title="Mở rộng hoặc thu gọn mục con"></span></span>' +
      '<span class="eye-m-name eye-broot-t" data-blk="' + esc(head) + '" title="Tiêu đề lớn: ' + esc(head) + '">' + esc(head) + '</span>' +
      (cnt ? '<span class="eye-count">' + cnt + '</span>' : '') +
      '<span class="eye-sp"></span>' +
      '<span class="eye-m-ic" data-bbmk="' + esc(head) + '" title="Lưu thành mục Thiết lập thế giới tùy chỉnh">' + IC_BOOK + '</span>' +
      '<span class="eye-m-ic" data-bsnd="1" title="Nối khối này vào thanh nhập chat">' + IC_SEND + '</span>' +
      '<span class="eye-m-ic" data-bpen="' + esc(head) + '" title="Sửa">' + IC_PEN + '</span>' +
      '<span class="eye-m-ic danger" data-bx="' + esc(head) + '" data-bcnt="' + (cnt || 0) + '" title="Xóa">' + IC_X + '</span>' +
    '</div>';
}

/* Trong cùng một mục Worldbook có thể chứa nhiều tiêu đề lớn, gom nhóm theo khối; khối không phải tiêu đề lớn mặc định sẽ chiếm một dòng riêng */
function setTreeIdx(nodes, globals) {
  (nodes || []).forEach(n => {
    if (typeof globals[n.idx] === 'number') n.idx = globals[n.idx];
    setTreeIdx(n.kids, globals);
  });
}

function worldItemsHtml(flat, head) {
  LAST_FLAT = flat || [];
  if (!flat || !flat.length) {
    return '<div class="eye-empty" style="margin-bottom:10px">' +
        '<div class="eye-empty-ico"></div>' +
        '<div class="eye-empty-t">Chưa có mục thiết lập thế giới</div>' +
        '<div class="eye-empty-s">Điền nội dung bên dưới, tiêu đề có thể để trống</div>' +
      '</div>';
  }
  const groups = [];
  flat.forEach((x, i) => {
    const h = String(x.head || '');
    let g = null;
    for (const q of groups) if (q.head === h) { g = q; break; }
    if (!g) { g = { head: h, raws: [], globals: [] }; groups.push(g); }
    g.raws.push(x.raw);
    g.globals.push(i);
  });
  const parts = groups.map(g => {
    const tree = itemTree(g.raws);
    setTreeIdx(tree, g.globals);
    const own = !!g.head && BLOCK_HEADS.indexOf(g.head) < 0;
    if (!own) tree.forEach(n => { n.head = g.head; });
    const inner = tree.map(n => treeRowHtml(n, '', own)).join('');
    if (!own) return inner;
    return blockRowHtml(g.head, tree.length) +
      '<div class="eye-kids"' + (BLOCK_SHUT[g.head] ? ' data-shut="1"' : '') + '>' + inner + '</div>';
  }).join('');
  return '<div class="eye-members">' + parts + '</div>';
}

let COMP_OPEN = false;
let COMP_KIND = 'world';
let COMP_HEAD = '';
let COMP_EDIT = '';
let COMP_IDX = -1;
let COMP_BLOCK = '';
let COMP_ROWS = [];
/* -1 = Chưa định vị đến dòng; -2 = Con trỏ nằm ở ô "Tiêu đề mục" (lấy ô này làm mốc để thêm dòng) */
let COMP_CUR = -1;

function compRowsHtml() {
  if (!COMP_ROWS.length) return '<div class="eye-comp-empty">Chưa có tiêu đề mục</div>';
  return COMP_ROWS.map((r, i) => {
    const top = !(r.d > 0);
    const noX = top && !String(r.x || '').trim();
    return '<div class="eye-comp-row' + (top ? ' top' : '') + (noX ? ' no-x' : '') + '" data-i="' + i + '"' +
      (top ? '' : ' style="padding-left:' + (r.d * 15) + 'px"') + '>' +
      '<input class="eye-comp-t" maxlength="24" placeholder="' + (top ? 'Tiêu đề mục (có thể để trống)' : 'Tiêu đề phụ') + '" value="' + esc(r.t) + '">' +
      (noX ? '' : '<input class="eye-comp-x" placeholder="Nội dung" value="' + esc(r.x) + '">') +
      '<span class="eye-m-ic danger" data-cdel="' + i + '" title="Xóa dòng này">' + IC_X + '</span>' +
    '</div>';
  }).join('');
}

function compEditorHtml() {
  const isPers = COMP_KIND === 'pers';
  const blk = (COMP_EDIT && COMP_BLOCK) ? COMP_BLOCK : blockHeadOf(COMP_KIND);
  return '<div class="eye-comp" id="eye-comp-box">' +
      '<div class="eye-comp-head" id="eye-comp-fixed" title="' + esc(blk) + '">' +
        '<span class="eye-comp-lb">' + (isPers ? 'Đối tượng' : 'Tiêu đề lớn') + '</span>' + esc(blk || 'Chưa thiết lập') + '</div>' +
      '<input class="eye-comp-head" id="eye-comp-t" maxlength="24" placeholder="Tiêu đề mục (có thể để trống)" value="' + esc(COMP_HEAD) + '">' +
      '<div id="eye-comp-rows">' + compRowsHtml() + '</div>' +
      '<div class="eye-comp-bar">' +
        '<span class="dg-eye-btn" id="eye-comp-sib">+ Cùng cấp</span>' +
        '<span class="dg-eye-btn" id="eye-comp-lv">+ Cấp dưới</span>' +
        '<span class="eye-spacer"></span>' +
        '<span class="dg-eye-btn" id="eye-comp-cust">Lưu</span>' +
        '<span class="dg-eye-btn" id="eye-comp-cancel">Hủy</span>' +
        '<span class="dg-eye-btn pri" id="eye-comp-save">Thêm</span>' +
      '</div>' +
    '</div>';
}

function compSync() {
  const t = doc.getElementById('eye-comp-t');
  if (t) COMP_HEAD = t.value;
  const rows = doc.getElementById('eye-comp-rows');
  if (!rows) return;
  rows.querySelectorAll('.eye-comp-row').forEach(el => {
    const i = parseInt(el.getAttribute('data-i'), 10);
    const a = el.querySelector('.eye-comp-t');
    const b = el.querySelector('.eye-comp-x');
    if (COMP_ROWS[i]) { COMP_ROWS[i].t = a ? a.value : ''; if (b) COMP_ROWS[i].x = b.value; }
  });
}

function compRepaint() {
  const rows = doc.getElementById('eye-comp-rows');
  if (rows) rows.innerHTML = compRowsHtml();
  const t = doc.getElementById('eye-comp-t');
  if (t && doc.activeElement !== t) t.value = COMP_HEAD;
}

function compFocusRow(i) {
  const rows = doc.getElementById('eye-comp-rows');
  if (!rows) return;
  const row = rows.querySelector('.eye-comp-row[data-i="' + i + '"]');
  const a = row ? row.querySelector('.eye-comp-t') : null;
  if (a) a.focus();
}

/* Ghi nhớ dòng hiện tại: Thao tác thêm "Cùng cấp" hay "Cấp dưới" đều lấy dòng này làm mốc */
function compSetCur(i) {
  const n = parseInt(i, 10);
  COMP_CUR = (n >= 0 && n < COMP_ROWS.length) ? n : -1;
}

/* Chèn một dòng sau dòng hiện tại; khi deeper là true thì phân cấp sâu hơn dòng hiện tại 1 bậc. Trả về chỉ số của dòng mới.
   d là phân cấp tương đối so với "Tiêu đề mục": 0 = cùng cấp với tiêu đề mục, 1 = cấp dưới của tiêu đề mục. */
function compInsertRow(deeper) {
  /* Khi con trỏ dừng ở ô "Tiêu đề mục" hoặc chưa định vị đến dòng nào, đều lấy tiêu đề mục trên đỉnh làm mốc:
     Cùng cấp = một tiêu đề mục khác, Cấp dưới = cấp liền dưới của nó. Con trỏ có thể đã rời đi (nhấn nút sẽ mất focus),
     do đó xét đồng thời cả focus và nhật ký focus. */
  const hIn = doc.getElementById ? doc.getElementById('eye-comp-t') : null;
  if (COMP_CUR < 0 || (hIn && doc.activeElement === hIn)) {
    const lv = deeper ? 1 : 0;
    /* Tiêu đề mục trên đỉnh tự tạo thành một khối, dòng mới nối vào cuối khối này: tức là trước dòng tiêu đề mục đầu tiên, nếu không có thì ở cuối */
    let at = 0;
    while (at < COMP_ROWS.length && COMP_ROWS[at].d > 0) at++;
    COMP_ROWS.splice(at, 0, { t: '', x: '', d: lv });
    COMP_CUR = at;
    return at;
  }
  if (COMP_CUR >= COMP_ROWS.length) COMP_CUR = COMP_ROWS.length - 1;
  const base = COMP_CUR >= 0 ? COMP_ROWS[COMP_CUR] : null;
  const at = COMP_CUR + 1;
  const lv = base ? (deeper ? base.d + 1 : base.d) : 0;
  COMP_ROWS.splice(at, 0, { t: '', x: '', d: lv });
  COMP_CUR = at;
  return at;
}

function compScroll() {
  const box = doc.getElementById('eye-comp-box');
  if (!box || !box.scrollIntoView) return;
  try { box.scrollIntoView({ block: 'nearest' }); } catch (e) { box.scrollIntoView(); }
}

function compRaws() {
  const head = String(COMP_HEAD || '').trim();
  const out = [];
  if (head) out.push(head + ':');
  for (const r of COMP_ROWS) {
    const t = String(r.t || '').trim();
    const x = String(r.x || '').trim();
    if (!t && !x) continue;
    const s = t ? (x ? t + ': ' + x : t + ':') : x;
    out.push(padItem(Math.max(0, r.d), s));
  }
  return out;
}

function compParse(txt) {
  const lines = String(txt == null ? '' : txt).split('\n');
  let head = '';
  const rows = [];
  for (const ln of lines) {
    if (!ln.trim()) continue;
    const pad = ln.length - ln.replace(/^[ ]+/, '').length;
    const s = ln.trim().replace(/^[-*·]\s*/, '');
    if (!head && !rows.length && pad === 0) {
      const h = splitHead(s);
      if (h) { head = h; continue; }
    }
    const hd = splitHead(s);
    const it = splitItem(s);
    rows.push({ t: hd || it.title, x: hd ? '' : it.text, d: Math.floor(pad / 2) });
  }
  return { head: head, rows: rows };
}

function compReset() {
  COMP_OPEN = false;
  COMP_EDIT = '';
  COMP_IDX = -1;
  COMP_BLOCK = '';
  COMP_HEAD = '';
  COMP_ROWS = [];
  COMP_CUR = -1;
}

async function addComposite(card, raws, kind) {
  if (!raws.length) return;
  const kd = kind || 'world';
  const cur = await loadList(card, kd);
  const names = cur.names.slice();
  const at = splitHead(raws[0]) ? names.indexOf(raws[0]) : -1;
  if (at >= 0) {
    let j = at + 1;
    while (j < names.length && itemDepth(names[j]) > 0) j++;
    names.splice(j, 0, ...raws.slice(1));
  } else {
    for (const r of raws) names.push(r);
  }
  await saveList(card, names, kd);
}

async function replaceBlock(card, oldRaw, raws, kind, idx) {
  const kd = kind || 'world';
  const cur = await loadList(card, kd);
  let items = cur.names;
  let head = cur.head;
  let at = items.indexOf(oldRaw);
  if (kd !== 'mon' && kd !== 'pers') {
    const loc = locateItem(cur, oldRaw, idx);
    if (loc) { items = loc.items; head = loc.head; at = loc.i; }
  }
  const names = items.slice();
  const i = (at >= 0 && names[at] === oldRaw) ? at : names.indexOf(oldRaw);
  if (i < 0) return false;
  const d = itemDepth(oldRaw);
  let j = i + 1;
  while (j < names.length && itemDepth(names[j]) > d) j++;
  names.splice(i, j - i, ...raws);
  if (kd !== 'mon' && kd !== 'pers') return await saveBlock(card, head, names, kd);
  await saveList(card, names, kd);
  return true;
}

async function compSave() {
  if (BUSY) return;
  const card = currentCharName();
  if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
  compSync();
  if (COMP_KIND === 'pers' && !String(MON_SEL || '').trim()) { tip('Vui lòng điền tên đối tượng trước', true); return; }
  const raws = compRaws();
  if (!raws.length) { tip('Chưa điền nội dung', true); return; }
  BUSY = true;
  try {
    let done = '';
    if (COMP_EDIT) {
      const ok = await replaceBlock(card, COMP_EDIT, raws, COMP_KIND, COMP_IDX);
      if (!ok) { tip('Không tìm thấy mục gốc, có thể đã bị thay đổi, hãy thử đóng và mở lại bảng điều khiển', true); return; }
      done = 'Đã lưu mục phức hợp';
    } else {
      await addComposite(card, raws, COMP_KIND);
      done = 'Đã thêm vào ' + (COMP_KIND === 'pers' ? 'Thiết lập nhân vật' : 'Thiết lập thế giới');
    }
    compReset();
    await renderPanel();
    tip(done);
  } catch (e) {
    tip('Lưu thất bại: ' + (e && e.message ? e.message : e), true);
  } finally { BUSY = false; }
}

function compCancel() {
  compReset();
  renderPanel();
}

async function openComposite(raw, kind, idx) {
  const card = currentCharName();
  if (!card) return;
  const kd = kind || 'world';
  const cur = await loadList(card, kd);
  let items = cur.names;
  let at = items.indexOf(raw);
  let blk = cur.head;
  if (kd !== 'mon' && kd !== 'pers') {
    const loc = locateItem(cur, raw, idx);
    if (loc) { items = loc.items; at = loc.i; blk = loc.head; }
  }
  if (at < 0) { tip('Không tìm thấy mục này, có thể đã bị thay đổi, hãy thử đóng và mở lại bảng điều khiển', true); return; }
  const d = itemDepth(raw);
  const rows = [];
  for (let j = at + 1; j < items.length && itemDepth(items[j]) > d; j++) {
    const hd = splitHead(items[j]);
    const it = splitItem(items[j]);
    rows.push({ t: hd || it.title, x: hd ? '' : it.text, d: itemDepth(items[j]) - d });
  }
  COMP_KIND = kd;
  COMP_EDIT = raw;
  COMP_IDX = Number.isFinite(idx) ? idx : -1;
  COMP_BLOCK = blk;
  COMP_HEAD = splitHead(raw) || '';
  COMP_ROWS = rows.length ? rows : [{ t: '', x: '', d: 1 }];
  COMP_CUR = -1;
  COMP_OPEN = true;
  clearCustomEdit();
  await renderPanel();
  compScroll();
}

function foldHtml(key, title, count, body) {
  return '<div class="eye-fold" data-fold="' + key + '">' +
      '<div class="eye-fold-hd">' +
        '<span class="eye-fold-ar"></span>' +
        '<span class="eye-fold-t">' + esc(title) + '</span>' +
        (count < 0 ? '' : '<span class="eye-count">' + count + '</span>') +
      '</div>' +
      '<div class="eye-fold-bd">' + body + '</div>' +
    '</div>';
}

const CHIP_MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

function chipLabel(text) {
  const body = splitDocTag(text, 'world').body;
  const t = String(body || '').trim();
  if (!t) return shorten(String(text == null ? '' : text));
  const lines = t.split('\n');
  const first = lines[0].trim();
  if (lines.length < 2) return shorten(t);
  const lb = splitItem(first).title || splitHead(first) || first;
  return (lb.length > 10 ? lb.slice(0, 10) + '…' : lb) + ' …';
}

/* Tên ngắn gọn dùng cho lời nhắc và danh sách: Chỉ lấy tiêu đề trước dấu hai chấm, không kèm nội dung */
function chipTitle(text) {
  const body = splitDocTag(text, 'world').body;
  const first = String(body || '').trim().split('\n')[0] || '';
  const lb = splitItem(first).title || splitHead(first) || first;
  return lb.length > 10 ? lb.slice(0, 10) + '…' : (lb || shorten(String(text == null ? '' : text)));
}

/* Tên hiển thị của một mục tùy chỉnh: Ưu tiên dùng tên được lưu riêng, nếu mục cũ không có tên thì suy ra theo nội dung */
function entryName(e) {
  const n = String((e && e.n) || '').trim();
  return n || chipLabel(e ? e.t : '');
}

function chipsHtml(arr) {
  if (!arr || !arr.length) return '<span class="eye-chips-empty">Chưa lưu mục tùy chỉnh nào</span>';
  const labels = arr.map(e => entryName(e));
  const total = {};
  labels.forEach(l => { total[l] = (total[l] || 0) + 1; });
  const seen = {};
  return arr.map((e, i) => {
    let label = labels[i];
    if (total[label] > 1) {
      seen[label] = (seen[label] || 0) + 1;
      label = label + ' ' + (CHIP_MARKS.charAt(seen[label] - 1) || '(' + seen[label] + ')');
    }
    const full = splitDocTag(e.t, 'world').body || String(e.t);
    const tipTxt = label === full ? full : labels[i] + '\n' + full;
    return '<span class="eye-chip" data-text="' + esc(e.t) + '" title="' + esc(tipTxt) + '">' +
      esc(label) +
      '<span class="eye-chip-x" title="Xóa">' + IC_MINUS + '</span>' +
    '</span>';
  }).join('');
}

const CUSTOM_KEY = 'dg_eye_custom';
function customMap() {
  let raw = {};
  try { raw = JSON.parse(window.localStorage.getItem(CUSTOM_KEY) || '{}') || {}; } catch (e) { raw = {}; }
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}
/* Một mục tùy chỉnh = Tên + Nội dung chính. Dữ liệu cũ lưu nội dung thuần túy, khi đọc ra sẽ bổ sung tên rỗng, hiển thị theo nội dung suy ra. */
function normEntry(x) {
  if (typeof x === 'string') return x ? { n: '', t: x } : null;
  if (x && typeof x === 'object' && typeof x.t === 'string' && x.t) {
    return { n: String(x.n == null ? '' : x.n), t: x.t };
  }
  return null;
}
function customsOf(card, group) {
  const c = card ? customMap()[card] : null;
  if (!c) return [];
  let arr = Array.isArray(c[group]) ? c[group] : null;
  if (!arr && group === 'Chỉ thị') arr = Array.isArray(c['Khen thưởng']) ? c['Khen thưởng'] : null;
  const out = [];
  const seen = {};
  for (const x of (arr || [])) {
    const e = normEntry(x);
    if (!e || seen[e.t]) continue;
    seen[e.t] = 1;
    out.push(e);
  }
  return out;
}
function saveCustoms(card, group, arr) {
  if (!card || !group) return;
  const m = customMap();
  if (!m[card] || typeof m[card] !== 'object' || Array.isArray(m[card])) m[card] = {};
  if (arr && arr.length) m[card][group] = arr.slice();
  else delete m[card][group];
  if (group === 'Chỉ thị') delete m[card]['Khen thưởng'];
  if (!Object.keys(m[card]).length) delete m[card];
  try { window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(m)); } catch (e) {}
}

/* Mục tùy chỉnh: Bọc một dòng thẻ tiêu đề lớn bên ngoài nội dung chính để ghi nhớ thuộc về khối nào; không hiển thị dòng này trong danh sách. */
function splitDocTag(text, kind) {
  const k = KINDS[kind || 'world'];
  const open = new RegExp('^<' + 'Toàn Thị Chi Nhãn_' + k.label + '_(.+)>$');
  const close = new RegExp('^</Toàn Thị Chi Nhãn_' + k.label + '_.+>$');
  let head = '';
  const body = [];
  for (const ln of String(text == null ? '' : text).split('\n')) {
    const t = ln.trim();
    if (!t) { body.push(ln); continue; }
    const mo = t.match(open);
    if (mo) { if (!head) head = mo[1].trim(); continue; }
    if (close.test(t)) continue;
    body.push(ln);
  }
  return { head: head, body: body.join('\n').replace(/^\n+/, '').replace(/\n+$/, '') };
}

function wrapDocTag(head, body) {
  const h = String(head || '').trim();
  const b = String(body == null ? '' : body).replace(/^\n+/, '').replace(/\n+$/, '');
  if (!h || !b) return b;
  return docTag('world', h) + '\n' + b + '\n' + docTagEnd('world', h);
}

/* Chữ ký dùng để phán đoán trùng lặp: Không nhìn cách viết, chỉ xét "Tầng thứ mấy + Tầng này viết cái gì".
   Dấu hai chấm toàn/bán giác, thụt lề mấy dấu cách, gạch đầu dòng, dấu cách nội dòng, dòng trống đều không tham gia so sánh. */
function textKey(text) {
  const rows = [];
  let stack = [];
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const s0 = String(raw).replace(/\t/g, '  ');
    const t0 = s0.trim();
    if (!t0) continue;
    if (/^<\/?Toàn Thị Chi Nhãn[_-]/.test(t0)) continue;
    const pad = (s0.match(/^ */) || [''])[0].length;
    let s = t0.replace(/^[-*·]\s*/, '').replace(/：/g, ':').replace(/\s+/g, ' ').trim();
    s = s.replace(/\s*:\s*/g, ': ').replace(/:\s*$/, '').trim();
    if (!s) continue;
    if (!stack.length) stack = [pad];
    else {
      while (stack.length > 1 && pad < stack[stack.length - 1]) stack.pop();
      if (pad > stack[stack.length - 1]) stack.push(pad);
    }
    rows.push((stack.length - 1) + '|' + s);
  }
  return rows.join('\n');
}

function topChunks(items) {
  const out = [];
  let cur = null;
  for (const it of (items || [])) {
    if (itemDepth(it) === 0 || !cur) { cur = [it]; out.push(cur); }
    else cur.push(it);
  }
  return out;
}

let BUILTIN_KEYS = null;
function builtinKeys(group) {
  if (!BUILTIN_KEYS) {
    const m = { 'Thiết lập thế giới': {}, 'Thiết lập nhân vật': {}, 'Chỉ thị': {} };
    const add = (g, t, c) => {
      m[g][textKey(String(t) + ':\n' + String(c || '').split('\n').map(l => '  ' + l).join('\n'))] = 1;
    };
    (WORLD_PRESETS || []).forEach(gr => (gr.items || []).forEach(p => add('Thiết lập thế giới', p.t, p.c)));
    (PERS_PRESETS || []).forEach(gr => (gr.items || []).forEach(p => add('Thiết lập nhân vật', p.t, p.c)));
    Object.keys(PRESETS || {}).forEach(k => (PRESETS[k] || []).forEach(p => { m['Chỉ thị'][textKey(p.tx)] = 1; }));
    BUILTIN_KEYS = m;
  }
  return BUILTIN_KEYS[group] || {};
}

const BUILTIN_MSG = {
  'Thiết lập thế giới': 'Mục này bị trùng lặp với mục Thiết lập thế giới mặc định',
  'Thiết lập nhân vật': 'Mục này bị trùng lặp với mục Thiết lập nhân vật mặc định',
  'Chỉ thị': 'Mục này bị trùng lặp với mục Chỉ thị mặc định',
};
const DUP_MSG = {
  'Thiết lập thế giới': 'Mục này đã được lưu trong Thiết lập thế giới tùy chỉnh',
  'Thiết lập nhân vật': 'Mục này đã được lưu trong Thiết lập nhân vật tùy chỉnh',
  'Chỉ thị': 'Mục này đã được lưu trong Chỉ thị tùy chỉnh',
};
const LOADED_MSG = {
  'Thiết lập thế giới': 'Đã tải Thiết lập thế giới "{n}"',
  'Thiết lập nhân vật': 'Đã tải Thiết lập nhân vật "{n}"',
  'Chỉ thị': 'Đã tải Chỉ thị "{n}"',
};
const EMPTY_MSG = 'Nội dung trống, không thể lưu';
function dupMsg(g) { return DUP_MSG[g] || 'Mục này đã được lưu trong mục tùy chỉnh'; }
function loadedMsg(g, name) { return (LOADED_MSG[g] || 'Đã tải "{n}"').replace('{n}', name); }

/* Sau khi nhấp mở một mục tùy chỉnh đã có, lúc lưu sẽ ghi đè chính mục đó chứ không tạo thêm mục trùng lặp.
   Ghi nhớ cả 3 giá trị cùng lúc để tránh sau khi đổi thẻ hoặc đổi nhóm bị sửa nhầm sang mục khác. */
let CUSTOM_EDIT_RAW = '';
let CUSTOM_EDIT_GROUP = '';
let CUSTOM_EDIT_CARD = '';
function clearCustomEdit() {
  CUSTOM_EDIT_RAW = '';
  CUSTOM_EDIT_GROUP = '';
  CUSTOM_EDIT_CARD = '';
}

/* Kiểm tra bắt buộc trước khi lưu: empty rỗng / builtin trùng bản tích hợp / dup đã có / '' có thể lưu */
function customBlock(card, group, body) {
  const b = String(body == null ? '' : body).replace(/^\n+/, '').replace(/\n+$/, '');
  if (!b.trim()) return 'empty';
  const key = textKey(b);
  if (!key) return 'empty';
  if (builtinKeys(group)[key]) return 'builtin';
  if (customsOf(card, group).some(x => textKey(x.t) === key)) return 'dup';
  return '';
}

/* Lưu một mục tùy chỉnh: added đã lưu / dup đã có / builtin trùng bản tích hợp / empty rỗng */
function addCustom(card, group, body, head, name) {
  const r0 = customBlock(card, group, body);
  if (r0) return r0;
  const b = String(body == null ? '' : body).replace(/^\n+/, '').replace(/\n+$/, '');
  const arr = customsOf(card, group);
  const text = group === 'Thiết lập thế giới' ? wrapDocTag(head || blockHeadOf('world'), b) : b;
  arr.push({ n: String(name == null ? '' : name).trim(), t: text });
  saveCustoms(card, group, arr);
  return 'added';
}

/* Lưu mục tùy chỉnh từ khu vực chỉnh sửa: Nếu lần này chỉnh sửa sau khi tải từ mục có sẵn thì thay thế mục đó, không thêm mới.
   Trả về: updated đã ghi đè / same không thay đổi / added / dup / builtin / empty */
function saveCustomFromEditor(card, group, body, head, name) {
  const b = String(body == null ? '' : body).replace(/^\n+/, '').replace(/\n+$/, '');
  if (!b.trim()) return 'empty';
  const key = textKey(b);
  if (!key) return 'empty';
  if (builtinKeys(group)[key]) return 'builtin';
  const arr = customsOf(card, group);
  const at = (CUSTOM_EDIT_RAW && CUSTOM_EDIT_GROUP === group && CUSTOM_EDIT_CARD === card)
    ? arr.findIndex(x => x.t === CUSTOM_EDIT_RAW) : -1;
  if (at < 0) return addCustom(card, group, b, head, name);
  const keep = group === 'Thiết lập thế giới' ? (splitDocTag(arr[at].t, 'world').head || head) : '';
  const text = group === 'Thiết lập thế giới' ? wrapDocTag(keep, b) : b;
  const nm = String(name == null ? '' : name).trim() || arr[at].n;
  if (arr[at].t === text && arr[at].n === nm) return 'same';
  if (arr.some((x, i) => i !== at && textKey(x.t) === key)) return 'dup';
  arr[at] = { n: nm, t: text };
  saveCustoms(card, group, arr);
  clearCustomEdit();
  return 'updated';
}

function plainItem(s) {
  return String(s == null ? '' : s).replace(/^ +/, '').replace(/^[-*·]\s*/, '').trim();
}

/* Đặt tên mặc định cho mục tùy chỉnh trước khi lưu:
   Mục đơn lấy tiêu đề của chính nó, nếu không có tiêu đề thì dùng nội dung;
   Mục phức hợp thì nếu tiêu đề lớn không thuộc 4 tiêu đề lớn mặc định sẽ dùng tiêu đề lớn, ngược lại dùng tiêu đề tầng cao nhất đầu tiên. */
function defaultCustomName(text, head, composite) {
  const body = splitDocTag(String(text == null ? '' : text), 'world').body || String(text == null ? '' : text);
  const lines = body.split(/\r?\n/).filter(l => String(l).trim());
  const first = lines.length ? plainItem(lines[0]) : '';
  if (!composite) {
    const nm = splitItem(first).title || splitHead(first) || '';
    return (nm || first || shorten(body)).slice(0, 24);
  }
  const h = String(head || '').trim();
  if (h && BLOCK_HEADS.indexOf(h) < 0) return h.slice(0, 24);
  const pads = lines.map(l => (String(l).match(/^[ \t]*/) || [''])[0].length);
  const minPad = Math.min.apply(null, pads);
  const tops = lines.filter((l, i) => pads[i] === minPad);
  for (const ln of tops) {
    const p = plainItem(ln);
    const nm = splitHead(p) || splitItem(p).title;
    if (nm) return nm.slice(0, 24);
  }
  return (plainItem(tops[0] || '') || first || shorten(body)).slice(0, 24);
}

/* Pop-up đặt tên: Tên mặc định đã được điền sẵn, xác nhận mới lưu. titles là tiêu đề hiển thị cho người dùng, items là các mục chờ đặt tên. */
function askName(title, init, onOk, onCancel) {
  const panel = doc.getElementById('dg-eye-panel');
  if (!panel) return;
  closeConfirm();
  const mask = doc.createElement('div');
  mask.className = 'eye-mask';
  mask.id = 'eye-mask';
  mask.innerHTML =
    '<div class="eye-dialog">' +
      '<div class="eye-dlg-t">' + esc(title) + '</div>' +
      '<div class="eye-dlg-lb">Tên</div>' +
      '<input class="eye-ren-input eye-dlg-input" maxlength="24" value="' + esc(init || '') + '">' +
      '<div class="eye-dlg-btns">' +
        '<span class="dg-eye-btn" data-no>Hủy</span>' +
        '<span class="dg-eye-btn pri" data-yes>Lưu</span>' +
      '</div>' +
    '</div>';
  panel.appendChild(mask);
  const ip = mask.querySelector('.eye-dlg-input');
  const no = () => { closeConfirm(); if (onCancel) onCancel(); };
  const ok = () => {
    const v = String(ip ? ip.value : '').replace(/\s+/g, ' ').trim();
    closeConfirm();
    if (onOk) onOk(v);
  };
  mask.querySelector('[data-no]').addEventListener('click', no);
  mask.querySelector('[data-yes]').addEventListener('click', ok);
  if (ip) {
    ip.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); ok(); }
      else if (e.key === 'Escape') { e.preventDefault(); no(); }
    });
    ip.focus(); ip.select();
  }
}

/* Pop-up đặt tên khi cần lưu nhiều mục cùng lúc: Mỗi dòng một mục, có thể sửa từng mục riêng biệt. */
function askNames(title, items, onOk, onCancel) {
  const panel = doc.getElementById('dg-eye-panel');
  if (!panel) return;
  closeConfirm();
  const mask = doc.createElement('div');
  mask.className = 'eye-mask';
  mask.id = 'eye-mask';
  const rows = items.map((e, i) =>
    '<div class="eye-name-row">' +
      (e.brief ? '<div class="eye-name-sub">' + esc(e.brief) + '</div>' : '') +
      '<input class="eye-ren-input eye-dlg-input" data-nm="' + i + '" maxlength="24" value="' + esc(e.n || '') + '">' +
    '</div>'
  ).join('');
  mask.innerHTML =
    '<div class="eye-dialog eye-dialog-wide">' +
      '<div class="eye-dlg-t">' + esc(title) + '</div>' +
      '<div class="eye-dlg-lb">' + items.length + ' mục dưới đây sẽ được lưu thành mục tùy chỉnh, tên có thể chỉnh sửa từng mục</div>' +
      '<div class="eye-name-list">' + rows + '</div>' +
      '<div class="eye-dlg-btns">' +
        '<span class="dg-eye-btn" data-no>Hủy</span>' +
        '<span class="dg-eye-btn pri" data-yes>Lưu</span>' +
      '</div>' +
    '</div>';
  panel.appendChild(mask);
  const collect = () => items.map((e, i) => {
    const ip = mask.querySelector('[data-nm="' + i + '"]');
    return String(ip ? ip.value : '').replace(/\s+/g, ' ').trim() || e.n;
  });
  const no = () => { closeConfirm(); if (onCancel) onCancel(); };
  const ok = () => { const v = collect(); closeConfirm(); if (onOk) onOk(v); };
  mask.querySelector('[data-no]').addEventListener('click', no);
  mask.querySelector('[data-yes]').addEventListener('click', ok);
  const first = mask.querySelector('.eye-dlg-input');
  if (first) { first.focus(); first.select(); }
}

function subtreeText(flat, idx) {
  const node = (flat || [])[idx];
  if (!node) return '';
  const base = itemDepth(node.raw);
  const out = [plainItem(node.raw)];
  for (let i = idx + 1; i < flat.length; i++) {
    const it = flat[i];
    if (it.head !== node.head) break;
    const d = itemDepth(it.raw);
    if (d <= base) break;
    out.push(padItem(d - base, plainItem(it.raw)));
  }
  return out.join('\n');
}

/* Lưu toàn bộ nội dung khối thành một mục tùy chỉnh, tên mặc định chính là tên khối */
function saveBlockCustom(head) {
  const flat = LAST_FLAT;
  const card = currentCharName();
  if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
  const blk = String(head || '').trim();
  const body = flat.map(x => x.raw).join('\n');
  const r0 = customBlock(card, 'Thiết lập thế giới', body);
  if (r0 === 'empty') { tip(EMPTY_MSG, true); return; }
  if (r0 === 'builtin') { tip(BUILTIN_MSG['Thiết lập thế giới']); return; }
  if (r0 === 'dup') { tip(dupMsg('Thiết lập thế giới')); return; }
  const dft = blk || defaultCustomName(body, blk, true);
  askName('Lưu thành Thiết lập thế giới tùy chỉnh', dft, name => {
    const nm = name || dft;
    const r = addCustom(card, 'Thiết lập thế giới', body, blk, nm);
    if (r === 'builtin') { tip(BUILTIN_MSG['Thiết lập thế giới']); return; }
    if (r === 'dup') { tip(dupMsg('Thiết lập thế giới')); return; }
    const box = doc.getElementById('eye-chips-set') || doc.getElementById('eye-chips');
    const fold = box && box.closest ? box.closest('.eye-fold') : null;
    if (fold) fold.classList.add('open');
    renderCustomChips();
    tip('Đã lưu thành Thiết lập thế giới tùy chỉnh: ' + nm);
  }, () => tip('Đã hủy, chưa lưu'));
}

/* Đổi tiêu đề lớn: Thay thẻ của toàn bộ khối sang tên mới */
function askRenameBlock(head) {
  const card = currentCharName();
  if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
  askInput('Sửa tiêu đề lớn', head, async v => {
    if (BUSY) return;
    const nm = String(v || '').trim();
    if (!nm) { tip('Tiêu đề lớn không được để trống', true); return; }
    if (nm === head) return;
    BUSY = true;
    try {
      const cur = await loadList(card, 'world');
      const same = (cur.blocks || []).filter(b => b.head === nm).length;
      if (same) { tip('Đã có tiêu đề lớn trùng tên: ' + nm, true); return; }
      await rewriteBlocks(card, 'world', blocks => blocks.map(b => (b.head === head ? { head: nm, items: b.items } : b)));
      if (String(WORLD_HEAD || '').trim() === head) WORLD_HEAD = nm;
      await renderPanel();
      tip('Tiêu đề lớn đã đổi thành: ' + nm);
    } catch (e) {
      tip('Sửa thất bại: ' + (e && e.message ? e.message : e), true);
    } finally {
      BUSY = false;
    }
  });
}

/* Xóa tiêu đề lớn: Xóa toàn bộ khối cùng nội dung bên trong */
function askDeleteBlock(head, cnt) {
  const card = currentCharName();
  if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
  askConfirm('Xóa tiêu đề lớn',
    'Sẽ xóa toàn bộ khối "' + head + '", ' + cnt + ' mục nội dung bên trong sẽ bị xóa cùng, nội dung gốc sẽ không thể khôi phục.',
    'Xác nhận xóa', async () => {
      if (BUSY) return;
      BUSY = true;
      try {
        await rewriteBlocks(card, 'world', blocks => blocks.filter(b => b.head !== head));
        if (String(WORLD_HEAD || '').trim() === head) WORLD_HEAD = '';
        await renderPanel();
        tip('Đã xóa tiêu đề lớn: ' + head);
      } catch (e) {
        tip('Xóa thất bại: ' + (e && e.message ? e.message : e), true);
      } finally {
        BUSY = false;
      }
    });
}

function saveRowCustom(idx) {
  const flat = LAST_FLAT;
  const node = flat[idx];
  if (!node) return;
  const card = currentCharName();
  if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
  const body = subtreeText(flat, idx);
  const r0 = customBlock(card, 'Thiết lập thế giới', body);
  if (r0 === 'empty') { tip(EMPTY_MSG, true); return; }
  if (r0 === 'builtin') { tip(BUILTIN_MSG['Thiết lập thế giới']); return; }
  if (r0 === 'dup') { tip(dupMsg('Thiết lập thế giới')); return; }
  const head = node.head || blockHeadOf('world');
  const dft = defaultCustomName(body, head, true);
  askName('Lưu thành Thiết lập thế giới tùy chỉnh', dft, name => {
    const nm = name || dft;
    const r = addCustom(card, 'Thiết lập thế giới', body, head, nm);
    if (r === 'builtin') { tip(BUILTIN_MSG['Thiết lập thế giới']); return; }
    if (r === 'dup') { tip(dupMsg('Thiết lập thế giới')); return; }
    const box = doc.getElementById('eye-chips-set') || doc.getElementById('eye-chips');
    const fold = box && box.closest ? box.closest('.eye-fold') : null;
    if (fold) fold.classList.add('open');
    renderCustomChips();
    tip('Đã lưu thành Thiết lập thế giới tùy chỉnh: ' + nm);
  }, () => tip('Đã hủy, chưa lưu'));
}

/* Tính toán trước những mục tùy chỉnh nào sẽ được thêm từ lần dán này, không sửa đổi gì; pop-up đặt tên sẽ chạy theo danh sách này */
function planPastedCustoms(card, blocks) {
  const out = { items: [], dup: 0, built: 0 };
  const seen = {};
  for (const b of (blocks || [])) {
    const bh = String(b.head == null ? '' : b.head).trim();
    /* Khi tiêu đề lớn có độ phân biệt thì tính cả khối là một mục, tên chính là tiêu đề lớn; 4 tiêu đề lớn mặc định mới chia nhỏ theo mục trên đỉnh */
    const whole = !!bh && BLOCK_HEADS.indexOf(bh) < 0;
    for (const c of (whole ? [b.items] : topChunks(b.items))) {
      const body = c.join('\n');
      if (!String(body).trim()) continue;
      const key = textKey(body);
      if (!key || seen[key]) continue;
      const r = customBlock(card, 'Thiết lập thế giới', body);
      if (r === 'builtin') { out.built++; continue; }
      if (r === 'dup') { out.dup++; continue; }
      if (r === 'empty') continue;
      seen[key] = 1;
      const head0 = plainItem(String(body).split('\n')[0]);
      out.items.push({
        body: body,
        head: bh,
        n: defaultCustomName(body, bh, true),
        brief: whole ? '' : (splitItem(head0).title || splitHead(head0) || head0 || '').slice(0, 20),
      });
    }
  }
  return out;
}

function savePastedCustoms(card, plan, names) {
  const out = { added: 0, dup: plan ? plan.dup : 0, built: plan ? plan.built : 0 };
  (plan ? plan.items : []).forEach((it, i) => {
    const nm = names ? (names[i] || it.n) : it.n;
    const r = addCustom(card, 'Thiết lập thế giới', it.body, it.head, nm);
    if (r === 'added') out.added++;
    else if (r === 'builtin') out.built++;
    else if (r === 'dup') out.dup++;
  });
  return out;
}

function askMerge(msg, onAppend, onReplace, canCover) {
  const panel = doc.getElementById('dg-eye-panel');
  if (!panel) return;
  closeConfirm();
  const mask = doc.createElement('div');
  mask.className = 'eye-mask';
  mask.id = 'eye-mask';
  mask.innerHTML =
    '<div class="eye-dialog">' +
      '<div class="eye-dlg-t">Nội dung import bị trùng lặp với nội dung đã lưu</div>' +
      '<div class="eye-dlg-m">' + esc(msg).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>') + '</div>' +
      '<div class="eye-dlg-btns">' +
        '<span class="dg-eye-btn" data-no>Hủy</span>' +
        '<span class="dg-eye-btn pri" data-add>Thêm tiếp</span>' +
        (canCover ? '<span class="dg-eye-btn danger" data-rep>Ghi đè</span>' : '') +
      '</div>' +
    '</div>';
  panel.appendChild(mask);
  mask.querySelector('[data-no]').addEventListener('click', () => { closeConfirm(); tip('Đã hủy, không thực hiện bất kỳ thay đổi nào'); });
  mask.querySelector('[data-add]').addEventListener('click', () => { closeConfirm(); if (onAppend) onAppend(); });
  const rep = mask.querySelector('[data-rep]');
  if (rep) rep.addEventListener('click', () => { closeConfirm(); if (onReplace) onReplace(); });
}

function cmdGroup() { return PANEL_VIEW === 'world' ? setGroup() : 'Chỉ thị'; }
function setGroup() { return SET_TAB === 'pers' ? 'Thiết lập nhân vật' : 'Thiết lập thế giới'; }
function chipsBox() { return doc.getElementById('eye-chips-set') || doc.getElementById('eye-chips'); }
function chipGroup() {
  const b = chipsBox();
  const g = b ? b.getAttribute('data-group') : '';
  return g || cmdGroup();
}

function renderCustomChips() {
  const box = chipsBox();
  if (!box) return;
  const arr = customsOf(currentCharName(), chipGroup());
  box.innerHTML = chipsHtml(arr);
  const fold = box.closest ? box.closest('.eye-fold') : null;
  const n = fold ? fold.querySelector('.eye-count') : null;
  if (n) n.textContent = arr.length;
}

function persistChipOrder() {
  const box = chipsBox();
  if (!box) return;
  const arr = customsOf(currentCharName(), chipGroup());
  const out = [];
  box.querySelectorAll('.eye-chip').forEach(c => {
    const t = c.getAttribute('data-text');
    const e = t == null ? null : arr.filter(x => x.t === t)[0];
    if (e && out.indexOf(e) < 0) out.push(e);
  });
  if (out.length !== arr.length) return;
  saveCustoms(currentCharName(), chipGroup(), out);
}

function customText() {
  const ta = doc.getElementById('eye-cmd');
  if (ta) return String(ta.value || '');
  const ti = doc.getElementById('eye-new-t');
  const inp = doc.getElementById('eye-new');
  if (!inp) return '';
  return joinItem(ti ? ti.value : '', inp.value);
}

/* Quy trình lưu mục tùy chỉnh thống nhất: Kiểm tra trùng lặp trước, sau đó bật pop-up đặt tên, xác nhận mới lưu vào đĩa */
function saveCustomFlow(card, group, txt, head, composite) {
  const key = textKey(txt);
  if (!key) { tip(EMPTY_MSG, true); return; }
  if (builtinKeys(group)[key]) { tip(BUILTIN_MSG[group] || 'Mục này bị trùng lặp với mục mặc định'); return; }
  const arr = customsOf(card, group);
  const editing = !!(CUSTOM_EDIT_RAW && CUSTOM_EDIT_GROUP === group && CUSTOM_EDIT_CARD === card);
  const at = editing ? arr.findIndex(x => x.t === CUSTOM_EDIT_RAW) : -1;
  if (arr.some((x, i) => i !== at && textKey(x.t) === key)) { tip(dupMsg(group)); return; }
  const dft = (at >= 0 && arr[at].n) ? arr[at].n : defaultCustomName(txt, head, composite);
  askName('Lưu thành ' + group + ' tùy chỉnh', dft, name => {
    const nm = name || dft;
    const r = saveCustomFromEditor(card, group, txt, head, nm);
    if (r === 'builtin') { tip(BUILTIN_MSG[group] || 'Mục này bị trùng lặp với mục mặc định'); return; }
    if (r === 'dup') { tip(dupMsg(group)); return; }
    if (r === 'same') { tip('Chưa sửa đổi nội dung, không thể lưu lặp lại'); return; }
    clearCustomEdit();
    const box = chipsBox();
    const fold = box && box.closest ? box.closest('.eye-fold') : null;
    if (fold) fold.classList.add('open');
    renderCustomChips();
    tip(r === 'updated' ? 'Đã cập nhật mục tùy chỉnh này' : 'Đã lưu thành ' + group + ' tùy chỉnh: ' + nm);
  }, () => tip('Đã hủy, chưa lưu'));
}

function doSaveCustom() {
  const txt = customText().replace(/\s*\r?\n\s*/g, ' ').trim();
  if (!txt) { tip(EMPTY_MSG, true); return; }
  const card = currentCharName();
  if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
  const group = chipGroup();
  saveCustomFlow(card, group, txt, group === 'Thiết lập thế giới' ? blockHeadOf('world') : '', false);
}

function compSaveCustom() {
  compSync();
  const txt = compRaws().join('\n').trim();
  if (!txt) { tip(EMPTY_MSG, true); return; }
  const card = currentCharName();
  if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
  const group = COMP_KIND === 'pers' ? 'Thiết lập nhân vật' : 'Thiết lập thế giới';
  const head = group === 'Thiết lập thế giới' ? (COMP_BLOCK || blockHeadOf('world')) : '';
  saveCustomFlow(card, group, txt, head, true);
}

function fillCustom(raw, note) {
  const ta = doc.getElementById('eye-cmd');
  if (ta) { ta.value = raw; ta.focus(); if (note) tip(note); return; }
  const tg = splitDocTag(raw, 'world');
  const body = tg.body || String(raw == null ? '' : raw);
  const head = String(tg.head || '').trim();
  const shift = !!(head && head !== String(WORLD_HEAD || '').trim());
  if (shift) WORLD_HEAD = head;
  if (body.indexOf('\n') >= 0) {
    const p = compParse(body);
    COMP_KIND = SET_TAB === 'pers' ? 'pers' : 'world';
    COMP_EDIT = '';
    COMP_IDX = -1;
    COMP_BLOCK = '';
    COMP_HEAD = COMP_KIND === 'pers' ? (MON_SEL || '') : (p.head || '');
    COMP_ROWS = p.rows.length ? p.rows : [{ t: '', x: '', d: 1 }];
    COMP_CUR = -1;
    COMP_OPEN = true;
    const done = () => { compScroll(); if (note) tip(note); };
    renderPanel().then(done, done);
    return;
  }
  const it = splitItem(body);
  const hd = it.title ? '' : splitHead(body);
  const fill = () => {
    const ti = doc.getElementById('eye-new-t');
    const inp = doc.getElementById('eye-new');
    if (ti) ti.value = it.title || hd || '';
    if (inp) {
      inp.value = it.title ? it.text : (hd ? '' : body);
      inp.focus();
    }
    if (note) tip(note);
  };
  if (shift) { renderPanel().then(fill, fill); return; }
  fill();
}

const HELP_PANES = {
  'Tổng quan':
    '<div class="eye-hlead"><b>Toàn Thị Chi Nhãn</b> là công cụ inject thiết lập, giám sát nhân vật và ban hành chỉ thị ở <b>tầng meta</b>.</div>' +
    '<div class="eye-hlist">' +
      '<div class="eye-hrow"><span class="k">Ghi chép</span><span class="v">Thêm hoặc xóa đối tượng giám sát.</span></div>' +
      '<div class="eye-hrow"><span class="k">Hồ sơ</span><span class="v">Xem lại hồ sơ giám sát theo từng tầng tin nhắn.</span></div>' +
      '<div class="eye-hrow"><span class="k">Thiết lập</span><span class="v">Inject thiết lập thế giới quan và thiết lập nhân vật.</span></div>' +
      '<div class="eye-hrow"><span class="k">Chỉ thị</span><span class="v">Ban hành chỉ thị cụ thể cho nhân vật.</span></div>' +
      '<div class="eye-hrow"><span class="k">Cài đặt</span><span class="v">Bảng cài đặt dành cho "Toàn Thị Chi Nhãn".</span></div>' +
      '<div class="eye-hrow"><span class="k">Hướng dẫn</span><span class="v">Thuyết minh tính năng của "Toàn Thị Chi Nhãn".</span></div>' +
    '</div>',
  'Thiết lập':
    '<div class="eye-hlead">Thiết lập là bản hướng dẫn sửa đổi thế giới quan và thiết lập nhân vật gửi cho AI.</div>' +
    '<div class="eye-hp">Chia thành 2 loại: Thiết lập thế giới quan (Thiết lập thế giới) và Thiết lập nhân vật.</div>' +
    '<div class="eye-hp">Bất kể thiết lập ban đầu của thẻ nhân vật là gì, đều sẽ chịu ảnh hưởng bởi các mục thiết lập được chèn vào.</div>' +
    '<div class="eye-hp">Từ hệ thống, harem thuộc SFW cho đến thường nhật, NTR thuộc NSFW;<br>từ thế giới quan và tiểu tiết cho đến độ khó, nhịp độ.</div>' +
    '<div class="eye-hp">Thế giới sẽ tuân theo ý chí của bạn mà vận hành về phương hướng đã định.</div>' +
    '<div class="eye-hp">Gợi ý: Việc chèn tiêu đề phụ có thể hỗ trợ AI hiểu rõ thiết lập hơn.</div>',
  'Giám sát':
    '<div class="eye-hlead">Giám sát là việc tận dụng AI để dòm ngó chuyên sâu theo thời gian thực đối với nhân vật chỉ định.</div>' +
    '<div class="eye-hp">Thêm tên vào trang "Ghi chép", AI sẽ thiết lập camera theo dõi cho bạn.</div>' +
    '<div class="eye-hp">Trong "Hồ sơ", bạn có thể truy vết lại các tầng tin nhắn trước đó để nghiền ngẫm từng bản ghi chép giám sát.</div>',
  'Chỉ thị':
    '<div class="eye-hlead">Chỉ thị là mệnh lệnh tối hậu mà bạn ban hành cho bất kỳ nhân vật nào.</div>' +
    '<div class="eye-hp">Được thiết lập sẵn 4 phân loại mặc định gồm Khen thưởng, Trừng phạt, Cải tạo, Tẩy não; mỗi mục đều chuẩn bị sẵn các thiết lập có sẵn, nhấp vào là có thể nhập ngay.</div>' +
    '<div class="eye-hp">Đồng thời hỗ trợ chỉ thị tùy chỉnh, sau khi lưu có thể tái sử dụng các chỉ thị ưng ý.</div>',
};

function viewHelpHtml() {
  const tabs = HELP_TABS.map(t =>
    '<span class="eye-tab' + (t === HELP_TAB ? ' on' : '') + '" data-htab="' + esc(t) + '">' + esc(t) + '</span>'
  ).join('');
  return '<section class="eye-sec eye-help">' +
      '<div class="eye-tabs" id="eye-htabs">' + tabs + '</div>' +
      (HELP_PANES[HELP_TAB] || HELP_PANES['Tổng quan']) +
    '</section>';
}

function setSwitchHtml(id, val, attr) {
  return '<div class="eye-sw' + (val ? ' on' : '') + '" id="' + id + '"' + (attr || '') +
    ' role="switch" tabindex="0" aria-checked="' + (val ? 'true' : 'false') + '"></div>';
}

function viewSetHtml(wb) {
  const list = Array.isArray(wb) ? wb : [];
  const live = list.filter(e => slotOn(e));
  const on = masterOn(list);
  const mods = modsMap();
  const loaded = live.filter(e => wbConst(e)).length;
  const row = (id, title, desc, val, dim) =>
    '<div class="eye-swrow' + (dim ? ' dim' : '') + '">' +
      '<div class="n"><b>' + esc(title) + '</b><i>' + esc(desc) + '</i></div>' +
      setSwitchHtml(id, val) +
    '</div>';
  return '<section class="eye-sec eye-help eye-settings">' +
      '<div class="eye-swrow">' +
        '<div class="n"><b>Toàn Thị Chi Nhãn</b><i>' +
          (on ? 'Đang có hiệu lực · ' + loaded + ' mục inject thường trực'
              : 'Đã tắt · Tất cả mục chuyển sang kích hoạt bằng từ khóa, không inject nữa') +
        '</i></div>' +
        setSwitchHtml('eye-sw', on) +
      '</div>' +
      '<div class="eye-sec-h"><span class="eye-sec-t">Công tắc chức năng</span></div>' +
      row('eye-mod-mon', 'Giám sát', 'Hai trang con Ghi chép và Hồ sơ, bao gồm mục đối tượng giám sát', mods.mon) +
      row('eye-mod-set', 'Thiết lập', 'Hai phân loại Thiết lập thế giới và Thiết lập nhân vật, bao gồm mục tương ứng', mods.set) +
      row('eye-mod-cmd', 'Chỉ thị', 'Chỉ thị tối cao ban hành cho nhân vật bất kỳ', mods.cmd) +
      '<div class="eye-sec-h"><span class="eye-sec-t">Tăng cường tính năng</span></div>' +
      row('eye-power', 'Chế độ cường lực', 'Chèn toàn bộ mục vào vị trí D0 ở cuối cùng của đối thoại', powerOn(list)) +
      row('eye-boost', 'Tăng cường đầu vào', 'Thêm một thẻ đánh dấu ẩn tăng cường tính năng vào trước nội dung gửi đi', boostOn(), !boostAble()) +
      '<div class="eye-sec-h"><span class="eye-sec-t">Hiển thị</span></div>' +
      row('eye-detach', 'Tách rời menu', 'Bảng điều khiển không còn bám theo bóng nổi, có thể kéo đến vị trí bất kỳ', detachOn()) +
      row('eye-simpleanim', 'Tối giản hiệu ứng', 'Tối giản hiệu ứng động của menu lục giác và phản hồi nhanh hơn', simpleAnimOn()) +
      '<div class="eye-sec-h"><span class="eye-sec-t">Khác</span></div>' +
      row('eye-cover', 'Ghi đè thiết lập', 'Khi import thiết lập bị trùng, có thể ghi đè toàn bộ khối lên nội dung cũ', coverOn()) +
      '<div class="dg-eye-msg"></div>' +
    '</section>';
}

function viewFileHtml(watch) {
  if (!watch.length) {
    return '<section class="eye-sec">' +
        '<div class="eye-empty"><div class="eye-empty-ico"></div>' +
        '<div class="eye-empty-t">Chưa có danh sách giám sát</div>' +
        '<div class="eye-empty-s">Vui lòng thêm đối tượng giám sát trong trang "Ghi chép" trước</div></div>' +
      '</section>';
  }
  if (watch.indexOf(MON_SEL) < 0) MON_SEL = watch[0];
  return '<section class="eye-sec">' +
      personBarHtml(watch, currentCharName()) +
      '<div id="eye-mon">' + fileBodyHtml() + '</div>' +
      filePagerHtml() +
    '</section>';
}

const PIN_ICON = '<span class="eye-pin" aria-hidden="true">' +
  '<svg viewBox="0 0 24 24" width="14" height="14" focusable="false">' +
    '<path fill="currentColor" d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>' +
  '</svg></span>';

function personBarHtml(watch, card) {
  const pins = pinsOf(card);
  const isPin = n => pins.indexOf(n) >= 0;
  const order = watch.filter(isPin).concat(watch.filter(n => !isPin(n)));
  return '<div class="eye-pbar eye-people">' + order.map(nm =>
    '<span class="eye-pchip' + (nm === MON_SEL ? ' on' : '') + (isPin(nm) ? ' pinned' : '') +
      '" data-pick="' + esc(nm) + '" title="' + esc(nm) + '">' +
      '<span class="eye-dot"></span>' + esc(nm) + PIN_ICON +
    '</span>'
  ).join('') + '</div>';
}

function svgIcon(path) {
  return '<svg viewBox="0 0 24 24" width="14" height="14" focusable="false">' +
    '<path fill="currentColor" d="' + path + '"/></svg>';
}
const IC_EYE = svgIcon('M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z');
const IC_PEN = svgIcon('M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z');
const IC_X = svgIcon('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z');
const IC_PLUS = svgIcon('M10.5 4.5h3v6h6v3h-6v6h-3v-6h-6v-3h6z');
const IC_MINUS = svgIcon('M4.5 10.5h15v3h-15z');
const IC_SEND = svgIcon('M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.58L20 12l-8-8-8 8z');
const IC_BOOK = svgIcon('M6 3h12c.55 0 1 .45 1 1v17l-7-4-7 4V4c0-.55.45-1 1-1z');

const PIN_KEY = 'dg_eye_pin';
function pinMap() {
  let raw = {};
  try { raw = JSON.parse(window.localStorage.getItem(PIN_KEY) || '{}') || {}; } catch (e) { raw = {}; }
  const out = {};
  for (const k in raw) {
    const v = raw[k];
    if (Array.isArray(v)) {
      const arr = v.filter(x => typeof x === 'string' && x);
      if (arr.length) out[k] = arr;
    } else if (typeof v === 'string' && v) {
      out[k] = [v];     
    }
  }
  return out;
}
function pinsOf(card) {
  const m = pinMap();
  return (card && Array.isArray(m[card])) ? m[card] : [];
}
function togglePin(card, name) {
  if (!card || !name) return;
  const m = pinMap();
  const arr = Array.isArray(m[card]) ? m[card].slice() : [];
  const i = arr.indexOf(name);
  if (i >= 0) arr.splice(i, 1); else arr.push(name);
  if (arr.length) m[card] = arr; else delete m[card];
  try { window.localStorage.setItem(PIN_KEY, JSON.stringify(m)); } catch (e) {}
}

function clampPage(total, page) {
  if (total < 1) return 1;
  return Math.min(Math.max(1, page), total);
}

function fileBodyHtml(recs) {
  if (!recs) recs = recordsOf(MON_SEL);
  if (!recs.length) return EMPTY_MON;
  const i = clampPage(recs.length, MON_PAGE);
  MON_PAGE = i;
  return monCardHtml(recs[i - 1]);
}

function filePagerHtml() {
  const recs = recordsOf(MON_SEL);
  const i = clampPage(recs.length, MON_PAGE);
  return '<div class="eye-pager" id="eye-pager"' + (recs.length < 2 ? ' style="display:none"' : '') + '>' +
      '<span class="dg-eye-btn" id="eye-prev"' + (i <= 1 ? ' disabled' : '') + '>Tầng trước</span>' +
      '<span class="eye-pageno" id="eye-pageno" title="Nhấp đúp hoặc nhấn giữ để chuyển đến bản ghi chép chỉ định">' + pageLabel(recs, i) + '</span>' +
      '<span class="dg-eye-btn" id="eye-next"' + (i >= recs.length ? ' disabled' : '') + '>Tầng sau</span>' +
    '</div>';
}

function pageLabel(recs, i) {
  if (!recs.length) return '';
  return '<b>' + clampPage(recs.length, i) + '</b> / ' + recs.length;
}

function applyFileView(forcePageno) {
  const d = doc;
  const card = currentCharName();
  const pins = pinsOf(card);
  d.querySelectorAll('#dg-eye-panel .eye-pchip[data-pick]').forEach(c => {
    const nm = c.getAttribute('data-pick');
    c.classList.toggle('on', nm === MON_SEL);
    c.classList.toggle('pinned', pins.indexOf(nm) >= 0);
  });
  const recs = recordsOf(MON_SEL);
  MON_PAGE = clampPage(recs.length, MON_PAGE);
  const mon = d.getElementById('eye-mon');
  if (mon) mon.innerHTML = fileBodyHtml(recs);
  const pager = d.getElementById('eye-pager');
  if (pager) pager.style.display = recs.length >= 2 ? '' : 'none';
  const pn = d.getElementById('eye-pageno');
  if (pn && (forcePageno || !d.getElementById('eye-page-input'))) pn.innerHTML = pageLabel(recs, MON_PAGE);
  const pv = d.getElementById('eye-prev'), nx = d.getElementById('eye-next');
  if (pv) pv.toggleAttribute('disabled', MON_PAGE <= 1);
  if (nx) nx.toggleAttribute('disabled', MON_PAGE >= recs.length);
}

function monCardHtml(t) {
  const gridFields = [
    ['look', 'Ngoại hình'], ['wear', 'Trang phục'], ['cond', 'Trạng thái'], ['mind', 'Tâm ý'],
  ];
  return '<div class="eye-card">' +
      '<div class="eye-card-top">' +
        '<span class="eye-card-name">' + esc(t.name) + '</span>' +
        (t.loc ? '<span class="eye-card-loc"><span>' + esc(t.loc) + '</span></span>' : '') +
        (t.floor ? '<span class="eye-card-floor">Tầng ' + t.floor + '</span>' : '') +
      '</div>' +
      '<div class="eye-card-act">' + esc(t.act || '—') + '</div>' +
      '<div class="eye-card-grid">' +
        gridFields.map(([k, lb]) =>
          '<div class="eye-f"><span class="eye-fk">' + lb + '</span><span class="eye-fv">' + esc(t[k] || '—') + '</span></div>'
        ).join('') +
      '</div>' +
    '</div>';
}

async function refreshMonitorOnly() {
  if (PANEL_VIEW !== 'file') return;
  if (!doc.getElementById('eye-mon')) return;
  applyFileView();
}

function askConfirm(title, msg, okText, onYes) {
  const panel = doc.getElementById('dg-eye-panel');
  if (!panel) return;
  closeConfirm();
  const mask = doc.createElement('div');
  mask.className = 'eye-mask';
  mask.id = 'eye-mask';
  mask.innerHTML =
    '<div class="eye-dialog">' +
      '<div class="eye-dlg-t">' + esc(title) + '</div>' +
      '<div class="eye-dlg-m">' + esc(msg) + '</div>' +
      '<div class="eye-dlg-btns">' +
        '<span class="dg-eye-btn" data-no>Hủy</span>' +
        '<span class="dg-eye-btn danger" data-yes>' + esc(okText || 'Xác nhận') + '</span>' +
      '</div>' +
    '</div>';
  panel.appendChild(mask);
  mask.querySelector('[data-no]').addEventListener('click', closeConfirm);
  mask.querySelector('[data-yes]').addEventListener('click', () => { closeConfirm(); if (onYes) onYes(); });
}

function closeConfirm() {
  const m = doc.getElementById('eye-mask');
  if (m && m.parentNode) m.parentNode.removeChild(m);
}

function askItem(raw, onOk) {
  const panel = doc.getElementById('dg-eye-panel');
  if (!panel) return;
  const it = splitItem(raw);
  closeConfirm();
  const mask = doc.createElement('div');
  mask.className = 'eye-mask';
  mask.id = 'eye-mask';
  mask.innerHTML =
    '<div class="eye-dialog">' +
      '<div class="eye-dlg-t">Sửa mục</div>' +
      '<input class="eye-ren-input eye-dlg-input" id="eye-it-t" maxlength="24" placeholder="Tiêu đề (có thể để trống)" value="' + esc(it.title) + '">' +
      '<input class="eye-ren-input eye-dlg-input" id="eye-it-x" placeholder="Nội dung" value="' + esc(it.text) + '">' +
      '<div class="eye-dlg-btns">' +
        '<span class="dg-eye-btn" data-no>Hủy</span>' +
        '<span class="dg-eye-btn pri" data-yes>Lưu</span>' +
      '</div>' +
    '</div>';
  panel.appendChild(mask);
  const ti = mask.querySelector('#eye-it-t');
  const tx = mask.querySelector('#eye-it-x');
  const ok = () => { const v = joinItem(ti.value, tx.value); closeConfirm(); if (onOk) onOk(v); };
  mask.querySelector('[data-no]').addEventListener('click', closeConfirm);
  mask.querySelector('[data-yes]').addEventListener('click', ok);
  [ti, tx].forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); ok(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); }
  }));
  tx.focus();
  tx.select();
}

function askInput(title, init, onOk) {
  const panel = doc.getElementById('dg-eye-panel');
  if (!panel) return;
  closeConfirm();
  const mask = doc.createElement('div');
  mask.className = 'eye-mask';
  mask.id = 'eye-mask';
  mask.innerHTML =
    '<div class="eye-dialog">' +
      '<div class="eye-dlg-t">' + esc(title) + '</div>' +
      '<input class="eye-ren-input eye-dlg-input" maxlength="60" value="' + esc(init || '') + '">' +
      '<div class="eye-dlg-btns">' +
        '<span class="dg-eye-btn" data-no>Hủy</span>' +
        '<span class="dg-eye-btn pri" data-yes>Lưu</span>' +
      '</div>' +
    '</div>';
  panel.appendChild(mask);
  const ip = mask.querySelector('.eye-dlg-input');
  const ok = () => { const v = ip.value; closeConfirm(); if (onOk) onOk(v); };
  mask.querySelector('[data-no]').addEventListener('click', closeConfirm);
  mask.querySelector('[data-yes]').addEventListener('click', ok);
  if (ip) {
    ip.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); ok(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); }
    });
    ip.focus(); ip.select();
  }
}

function askSlotSeq(prefix, init, onOk) {
  const panel = doc.getElementById('dg-eye-panel');
  if (!panel) return;
  closeConfirm();
  const mask = doc.createElement('div');
  mask.className = 'eye-mask';
  mask.id = 'eye-mask';
  mask.innerHTML =
    '<div class="eye-dialog">' +
      '<div class="eye-dlg-t">Đổi số thứ tự mục</div>' +
      '<div class="eye-seq-row">' +
        '<span class="eye-seq-fix">' + esc(prefix) + '</span>' +
        '<input class="eye-ren-input eye-seq-input" inputmode="numeric" maxlength="4" value="' + esc(init || '') + '">' +
      '</div>' +
      '<div class="eye-dlg-btns">' +
        '<span class="dg-eye-btn" data-no>Hủy</span>' +
        '<span class="dg-eye-btn pri" data-yes>Lưu</span>' +
      '</div>' +
    '</div>';
  panel.appendChild(mask);
  const ip = mask.querySelector('.eye-seq-input');
  const ok = () => { const v = ip.value; closeConfirm(); if (onOk) onOk(v); };
  mask.querySelector('[data-no]').addEventListener('click', closeConfirm);
  mask.querySelector('[data-yes]').addEventListener('click', ok);
  if (ip) {
    ip.addEventListener('input', () => { ip.value = ip.value.replace(/\D/g, ''); });
    ip.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); ok(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); }
    });
    ip.focus(); ip.select();
  }
}

async function renameSlot(oldName, newName, kind) {
  const k = KINDS[kind];
  const final = String(newName || '').trim();
  if (!final || final === oldName) return oldName;
  if (final.indexOf(k.prefix) !== 0) throw new Error('Tên mục phải bắt đầu bằng "' + k.prefix + '"');
  const slots = await readSlots(kind);
  if (slots.some(s => slotName(s) === final)) throw new Error('Đã có một mục mang tên "' + final + '" rồi');
  await updateWorldbookWith(WB_NAME, wb => wb.map(e => {
    if (slotName(e) !== oldName) return e;
    return (typeof e.name === 'string' && e.name)
      ? { ...e, name: final }
      : { ...e, comment: final };
  }));
  return final;
}

async function deleteSlot(card, name, kind) {
  await updateWorldbookWith(WB_NAME, wb => wb.filter(e => slotName(e) !== name));
  const slots = await readSlots(kind);
  const mine = slotsOfCard(slots, card, kind);
  if (mine.length && !mine.some(slotOn)) {
    await switchSlot(card, kind, slotName(mine[mine.length - 1]));
  }
}

async function renameTarget(card, oldName, newName, kind) {
  const cur = await loadList(card, kind);
  if (kind !== 'mon' && kind !== 'pers' && (cur.flat || []).length) {
    const hit = pickFlat(cur.flat, -1, oldName);
    if (!hit) return oldName;
    const blk = findBlock(cur.blocks, hit.head);
    if (!blk) return oldName;
    const arr = blk.items.slice();
    const depth = itemDepth(arr[hit.i]);
    let final = String(newName || '').trim() || oldName.trim();
    if (arr.some((n, k) => k !== hit.i && n.trim() === final)) {
      const base = final;
      for (let k = 1; k < 999; k++) {
        if (!arr.some((n, j) => j !== hit.i && n.trim() === base + '-' + k)) { final = base + '-' + k; break; }
      }
    }
    arr[hit.i] = padItem(depth, final);
    await saveBlock(card, hit.head, arr, kind);
    return final;
  }
  const names = cur.names.slice();
  const i = names.indexOf(oldName);
  if (i < 0) return oldName;
  const depth = itemDepth(oldName);
  let final = String(newName || '').trim() || oldName.trim();
  if (names.some((n, idx) => idx !== i && n.trim() === final)) {
    const base = final;
    for (let k = 1; k < 999; k++) {
      if (!names.some((n, idx) => idx !== i && n.trim() === base + '-' + k)) { final = base + '-' + k; break; }
    }
  }
  names[i] = padItem(depth, final);
  await saveList(card, names, kind);
  return final;
}

async function doRename(oldName, rawNew, kind) {
  if (BUSY) return;
  const name = String(rawNew || '').trim();
  if (!name) { tip('Tên mới không được để trống', true); return; }
  if (name === oldName.trim()) { await renderPanel(); return; }
  const card = currentCharName();
  if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
  BUSY = true;
  try {
    const final = await renameTarget(card, oldName, name, kind);
    if (kind === 'mon' && MON_SEL === oldName) MON_SEL = final;
    await renderPanel();
    tip('Đã đổi tên thành: ' + final);
  } catch (e) {
    tip('Đổi tên thất bại: ' + (e && e.message ? e.message : e), true);
  } finally {
    BUSY = false;
  }
}

function shorten(s) {
  return s.length > 8 ? s.slice(0, 8) + '…' : s;
}

function bindPanel() {
  const d = doc;
  const genOpen = d.getElementById('eye-gen-open');
  if (genOpen) genOpen.addEventListener('click', () => openView('gen'));
  const genBack = d.getElementById('eye-gen-back');
  if (genBack) genBack.addEventListener('click', () => openView('world'));
  const genSend = d.getElementById('eye-gen-send');
  if (genSend) genSend.addEventListener('click', doGenSend);
  const genName = d.getElementById('eye-gen-name');
  if (genName) genName.addEventListener('input', () => { GEN_OPTS.name = genName.value; });
  [['eye-gen-kind', 'kind'], ['eye-gen-scope', 'scope'], ['eye-gen-nsfw', 'nsfw'], ['eye-gen-fsm', 'fsm']].forEach(g => {
    const sel = d.getElementById(g[0]);
    if (!sel) return;
    sel.addEventListener('change', () => { GEN_OPTS[g[1]] = sel.value; });
  });
  const kind = viewKind();
  const k = KINDS[kind];
  const isWorld = kind === 'world';
  const isPers = kind === 'pers';
  const isMon = kind === 'mon';
  const addBtn = d.getElementById('eye-add');
  const inp = d.getElementById('eye-new');

  const doAdd = async () => {
    if (BUSY) { tip('Đang xử lý bước trước, vui lòng đợi giây lát', true); return; }
    const tin = d.getElementById('eye-new-t');
    const txt = (inp ? inp.value : '').replace(/\s*\r?\n\s*/g, ' ').trim();
    if (!txt) { tip(isMon ? 'Vui lòng điền tên nhân vật' : 'Vui lòng điền nội dung', true); return; }
    if (isPers && !String(MON_SEL || '').trim()) { tip('Vui lòng điền tên đối tượng phía trên trước', true); return; }
    const name = isWorld ? joinItem(tin ? tin.value : '', txt) : txt;
    const card = currentCharName();
    if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại, không thể phân nhóm', true); return; }
    BUSY = true; addBtn.style.opacity = '.45';
    try {
      const final = await addTarget(card, name, kind);
      if (inp) inp.value = '';
      if (isWorld && tin) tin.value = '';
      await renderPanel();
      tip('Đã thêm vào ' + (isWorld ? 'Thiết lập thế giới' : isPers ? 'Thiết lập nhân vật' : 'giám sát') + ': ' + final);
    } catch (e) {
      tip('Thêm thất bại: ' + (e && e.message ? e.message : e), true);
    } finally {
      BUSY = false; addBtn.style.opacity = '';
    }
  };
  if (addBtn) addBtn.addEventListener('click', doAdd);

  const doImport = (text, mode, noted) => {
    if (BUSY) { tip('Đang xử lý bước trước, vui lòng đợi giây lát', true); return; }
    const blocks = parsePasteDoc(text, 'world');
    if (!blocks.length) { tip('Không nhận diện được nội dung thiết lập khả dụng', true); return; }
    const card = currentCharName();
    if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại, không thể phân nhóm', true); return; }
    const plan = planPastedCustoms(card, blocks);
    const run = async names => {
      BUSY = true; if (addBtn) addBtn.style.opacity = '.45';
      try {
        MERGE_SKIPPED = 0;
        await importDocBlocks(card, blocks, 'world', mode);
        const saved = savePastedCustoms(card, plan, names);
        WORLD_HEAD = blocks[0].head;
        if (inp) inp.value = '';
        const tin = d.getElementById('eye-new-t');
        if (tin) tin.value = '';
        const parts = ['Đã thêm vào Thiết lập thế giới: ' + blocks.map(b => b.head).join(', ') +
          (noted ? (mode === 'append' ? ' (Thêm tiếp)' : ' (Ghi đè)') : '')];
        if (saved.added) parts.push('Đã lưu thành Thiết lập thế giới tùy chỉnh ' + saved.added + ' mục');
        if (saved.dup) parts.push(saved.dup + ' mục đã tồn tại');
        if (saved.built) parts.push(saved.built + ' mục trùng lặp với bản tích hợp');
        if (MERGE_SKIPPED) parts.push('Bỏ qua ' + MERGE_SKIPPED + ' mục trùng lặp');
        await renderPanel();
        tip(parts.join('; '));
      } catch (e) {
        tip('Thêm thất bại: ' + (e && e.message ? e.message : e), true);
      } finally {
        BUSY = false; if (addBtn) addBtn.style.opacity = '';
      }
    };
    if (plan.items.length === 1) {
      const one = plan.items[0];
      askName('Lưu thành Thiết lập thế giới tùy chỉnh', one.n, nm => { run([nm || one.n]); }, () => tip('Đã hủy, chưa lưu'));
      return;
    }
    if (plan.items.length) {
      askNames('Lưu thành Thiết lập thế giới tùy chỉnh', plan.items, names => { run(names); }, () => tip('Đã hủy, chưa lưu'));
      return;
    }
    run(null);
  };

  const beginImport = async text => {
    if (BUSY) { tip('Đang xử lý bước trước, vui lòng đợi giây lát', true); return; }
    const blocks = parsePasteDoc(text, 'world');
    if (!blocks.length) { tip('Không nhận diện được nội dung thiết lập khả dụng', true); return; }
    const card = currentCharName();
    if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại, không thể phân nhóm', true); return; }
    let hits = [];
    let heads = [];
    try {
      const cur = await loadList(card, 'world');
      blocks.forEach(b => {
        const f = findBlock(cur.blocks, b.head);
        if (f && (f.items || []).length) {
          heads.push(b.head);
          hits.push('Dưới "' + b.head + '" đã lưu ' + topChunks(f.items).length + ' mục, lần này import ' + topChunks(b.items).length + ' mục');
        }
      });
    } catch (e) { hits = []; heads = []; }
    if (!hits.length) { doImport(text, 'append', false); return; }
    const cover = coverOn();
    askMerge(hits.join('; ') + '. Chọn "Thêm tiếp" sẽ giữ lại nội dung cũ và nối tiếp nội dung không trùng của bản import vào sau; ' +
        (cover
          ? 'chọn "Ghi đè" sẽ ghi đè toàn bộ khối từ tầng đỉnh của ' + heads.map(h => '"' + h + '"').join(', ') + ', nội dung cũ sẽ **không thể khôi phục**.'
          : 'nội dung trùng lặp sẽ bị bỏ qua.'),
      () => doImport(text, 'append', true),
      () => doImport(text, 'replace', true),
      cover);
  };

  if (inp && isWorld) {
    inp.addEventListener('paste', e => {
      const cd = e.clipboardData;
      const txt = cd && cd.getData ? cd.getData('text') : '';
      if (!txt || !looksLikeDoc(txt)) return;
      e.preventDefault();
      beginImport(txt);
    });
  }
  if (inp) {
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (inp.tagName === 'TEXTAREA' && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      doAdd();
    });
  }

  const compBtn = d.getElementById('eye-comp');
  if (compBtn) compBtn.addEventListener('click', () => {
    if (COMP_OPEN && COMP_KIND === kind) { compReset(); renderPanel(); return; }
    COMP_KIND = kind;
    COMP_EDIT = '';
    COMP_IDX = -1;
    COMP_BLOCK = '';
    COMP_HEAD = '';
    COMP_ROWS = [{ t: '', x: '', d: 1 }];
    COMP_CUR = -1;
    COMP_OPEN = true;
    clearCustomEdit();
    renderPanel().then(compScroll, compScroll);
  });

  if (COMP_OPEN && COMP_KIND === kind) {
    const head = d.getElementById('eye-comp-t');
    if (head) {
      head.addEventListener('input', () => { COMP_HEAD = head.value; });
      /* Con trỏ dừng ở "Tiêu đề mục" thì không có focus nội dòng, thêm dòng sẽ lấy tiêu đề mục làm mốc */
      head.addEventListener('focusin', () => { COMP_CUR = -2; });
      head.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); compSave(); }
        else if (e.key === 'Escape') { e.preventDefault(); compCancel(); }
      });
    }
    const rowBox = d.getElementById('eye-comp-rows');
    if (rowBox) rowBox.addEventListener('focusin', e => {
      const row = e.target && e.target.closest ? e.target.closest('.eye-comp-row') : null;
      if (row) compSetCur(row.getAttribute('data-i'));
    });
    if (rowBox) rowBox.addEventListener('click', e => {
      const del = e.target && e.target.closest ? e.target.closest('[data-cdel]') : null;
      const row = e.target && e.target.closest ? e.target.closest('.eye-comp-row') : null;
      if (!del) {
        if (row) compSetCur(row.getAttribute('data-i'));
        return;
      }
      compSync();
      const i = parseInt(del.getAttribute('data-cdel'), 10);
      if (i >= 0) COMP_ROWS.splice(i, 1);
      if (COMP_CUR === i) COMP_CUR = Math.min(i, COMP_ROWS.length - 1);
      else if (COMP_CUR > i) COMP_CUR--;
      if (!COMP_ROWS.length) COMP_CUR = -1;
      compRepaint();
    });
    const pushRow = deeper => {
      compSync();
      const at = compInsertRow(deeper);
      compRepaint();
      compFocusRow(at);
    };
    const sibBtn = d.getElementById('eye-comp-sib');
    if (sibBtn) sibBtn.addEventListener('click', () => pushRow(false));
    const lvBtn = d.getElementById('eye-comp-lv');
    if (lvBtn) lvBtn.addEventListener('click', () => pushRow(true));
    const ccBtn = d.getElementById('eye-comp-cancel');
    if (ccBtn) ccBtn.addEventListener('click', compCancel);
    const cuBtn = d.getElementById('eye-comp-cust');
    if (cuBtn) cuBtn.addEventListener('click', compSaveCustom);
    const csBtn = d.getElementById('eye-comp-save');
    if (csBtn) csBtn.addEventListener('click', compSave);
  }

  d.querySelectorAll('#dg-eye-panel [data-tog]').forEach(el => {
    el.addEventListener('click', () => {
      const node = el.closest ? el.closest('.eye-node') : null;
      const box = node ? node.nextElementSibling : null;
      if (!box || !box.classList || !box.classList.contains('eye-kids')) return;
      const pen = node.querySelector('[data-pen]');
      const raw = pen ? pen.getAttribute('data-pen') : '';
      if (box.getAttribute('data-shut') === '1') {
        box.removeAttribute('data-shut');
        el.classList.add('on');
        if (raw) delete TREE_SHUT[raw];
      } else {
        box.setAttribute('data-shut', '1');
        el.classList.remove('on');
        if (raw) TREE_SHUT[raw] = true;
      }
    });
  });

  d.querySelectorAll('#dg-eye-panel [data-eye]').forEach(el => {
    el.addEventListener('click', () => {
      MON_SEL = el.getAttribute('data-eye');
      MON_PAGE = 1;
      openView('file');
    });
  });
  d.querySelectorAll('#dg-eye-panel [data-pen]').forEach(el => {
    el.addEventListener('click', () => {
      const nm = el.getAttribute('data-pen');
      if (isMon) { askInput('Sửa họ tên', nm, v => doRename(nm, v, kind)); return; }
      const node = el.closest ? el.closest('.eye-node') : null;
      if ((isWorld || isPers) && node && splitHead(nm)) {
        openComposite(nm, kind, parseInt(el.getAttribute('data-i'), 10));
        return;
      }
      askItem(nm, v => doRename(nm, v, kind));
    });
  });
  d.querySelectorAll('#dg-eye-panel [data-x]').forEach(el => {
    el.addEventListener('click', () => {
      const nm = el.getAttribute('data-x');
      const idx = parseInt(el.getAttribute('data-i'), 10);
      const node = el.closest ? el.closest('.eye-node') : null;
      const withKids = (isWorld || isPers) && node && node.querySelector('[data-tog]');
      const short = splitItem(nm).title || splitHead(nm) || splitItem(nm).text || nm;
      const askT = isMon ? 'Xóa khỏi giám sát' : 'Xóa mục';
      const askM = isMon ? ('Bạn có chắc chắn muốn xóa "' + nm + '" khỏi danh sách giám sát này?')
        : (withKids ? ('Bạn có chắc chắn muốn xóa "' + short + '" cùng các mục con bên dưới?') : ('Bạn có chắc chắn muốn xóa "' + short + '"?'));
      const askB = isMon ? 'Xác nhận xóa khỏi danh sách' : 'Xác nhận xóa';
      askConfirm(askT, askM, askB, async () => {
        if (BUSY) { tip('Đang xử lý bước trước, vui lòng đợi giây lát', true); return; }
        BUSY = true;
        try {
          const ok = await delTarget(currentCharName(), nm, idx, kind);
          if (!ok) { tip('Không tìm thấy mục này, có thể đã bị thay đổi, hãy thử đóng và mở lại bảng điều khiển', true); return; }
          if (isMon && MON_SEL === nm) MON_SEL = null;
          MON_PAGE = 1;
          await renderPanel();
          tip(isMon ? 'Đã xóa khỏi giám sát' : 'Đã xóa');
        } catch (e) {
          tip((isMon ? 'Xóa khỏi danh sách thất bại: ' : 'Xóa thất bại: ') + (e && e.message ? e.message : e), true);
        } finally { BUSY = false; }
      });
    });
  });

  d.querySelectorAll('#dg-eye-panel #eye-stabs .eye-tab').forEach(el => {
    el.addEventListener('click', () => {
      const t = el.getAttribute('data-stab');
      if (!t || t === SET_TAB) return;
      SET_TAB = t;
      clearCustomEdit();
      MON_PAGE = 1;
      renderPanel();
    });
  });

  const syncWhead = () => {
    d.querySelectorAll('#dg-eye-panel [data-whead]').forEach(x => {
      x.classList.toggle('on', (x.getAttribute('data-whead') || '') === WORLD_HEAD);
    });
    const inp = d.getElementById('eye-world-head');
    if (inp) inp.value = WORLD_HEAD;
    if (COMP_OPEN) renderPanel();
  };

  const worldHead = d.getElementById('eye-world-head');
  if (worldHead) {
    worldHead.addEventListener('input', () => {
      WORLD_HEAD = worldHead.value.trim();
    });
    worldHead.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      WORLD_HEAD = worldHead.value.trim();
      syncWhead();
    });
  }
  d.querySelectorAll('#dg-eye-panel [data-whead]').forEach(el => {
    el.addEventListener('click', () => {
      WORLD_HEAD = el.getAttribute('data-whead') || '';
      syncWhead();
    });
  });

  const persSel = d.getElementById('eye-pers-target');
  if (persSel) {
    persSel.addEventListener('input', () => {
      MON_SEL = persSel.value.trim();
    });
    persSel.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      MON_SEL = persSel.value.trim();
      renderPanel();
    });
  }
  d.querySelectorAll('#dg-eye-panel [data-pobj]').forEach(el => {
    el.addEventListener('click', () => {
      MON_SEL = el.getAttribute('data-pobj') || '';
      renderPanel();
    });
  });

  const objInp = d.getElementById('eye-target');
  if (objInp) {
    objInp.addEventListener('input', () => {
      CMD_OBJ = objInp.value.trim();
      CMD_OBJ_CARD = currentCharName();
    });
  }
  d.querySelectorAll('#dg-eye-panel [data-cobj]').forEach(el => {
    el.addEventListener('click', () => {
      CMD_OBJ = el.getAttribute('data-cobj') || '';
      CMD_OBJ_CARD = currentCharName();
      if (objInp) objInp.value = CMD_OBJ;
      d.querySelectorAll('#dg-eye-panel [data-cobj]').forEach(x => {
        x.classList.toggle('on', (x.getAttribute('data-cobj') || '') === CMD_OBJ);
      });
    });
  });

  const send = d.getElementById('eye-send');
  if (send) send.addEventListener('click', doSend);

  const saveBtn = d.getElementById('eye-save');
  if (saveBtn) saveBtn.addEventListener('click', doSaveCustom);

  d.querySelectorAll('#dg-eye-panel [data-bmk]').forEach(el => {
    el.addEventListener('click', () => {
      saveRowCustom(parseInt(el.getAttribute('data-bmk'), 10));
    });
  });
  d.querySelectorAll('#dg-eye-panel [data-snd]').forEach(el => {
    el.addEventListener('click', () => {
      doSendSetting(el.getAttribute('data-snd'));
    });
  });
  d.querySelectorAll('#dg-eye-panel [data-bbmk]').forEach(el => {
    el.addEventListener('click', () => {
      saveBlockCustom(el.getAttribute('data-bbmk'));
    });
  });
  d.querySelectorAll('#dg-eye-panel [data-bsnd]').forEach(el => {
    el.addEventListener('click', () => {
      doSendSetting(LAST_FLAT.map(x => x.raw).join('\n'));
    });
  });
  d.querySelectorAll('#dg-eye-panel [data-bpen]').forEach(el => {
    el.addEventListener('click', () => {
      askRenameBlock(el.getAttribute('data-bpen'));
    });
  });
  d.querySelectorAll('#dg-eye-panel [data-bx]').forEach(el => {
    el.addEventListener('click', () => {
      askDeleteBlock(el.getAttribute('data-bx'), parseInt(el.getAttribute('data-bcnt'), 10) || 0);
    });
  });
  d.querySelectorAll('#dg-eye-panel [data-btog]').forEach(el => {
    el.addEventListener('click', () => {
      const node = el.closest ? el.closest('.eye-broot') : null;
      const box = node ? node.nextElementSibling : null;
      if (!box || !box.classList || !box.classList.contains('eye-kids')) return;
      const nmEl = node.querySelector('[data-blk]');
      const blk = nmEl ? nmEl.getAttribute('data-blk') : '';
      if (box.getAttribute('data-shut') === '1') {
        box.removeAttribute('data-shut');
        el.classList.add('on');
        if (blk) delete BLOCK_SHUT[blk];
      } else {
        box.setAttribute('data-shut', '1');
        el.classList.remove('on');
        if (blk) BLOCK_SHUT[blk] = true;
      }
    });
  });
  d.querySelectorAll('#dg-eye-panel .eye-fold-hd').forEach(el => {
    el.addEventListener('click', () => {
      const fold = el.parentNode;
      if (fold && fold.classList) fold.classList.toggle('open');
    });
  });

  const slotSel = d.getElementById('eye-slot');
  const curSlot = () => (slotSel ? slotSel.value : '');

  if (slotSel) {
    slotSel.addEventListener('change', async () => {
      const nm = slotSel.value;
      if (!nm || BUSY) return;
      const card = currentCharName();
      if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
      BUSY = true;
      try {
        await switchSlot(card, kind, nm);
        MON_PAGE = 1;
        await renderPanel();
        tip('Đã chuyển sang "' + nm + '"');
      } catch (e) {
        tip('Chuyển đổi thất bại: ' + (e && e.message ? e.message : e), true);
      } finally { BUSY = false; }
    });
  }

  const slotRen = d.getElementById('eye-slot-ren');
  if (slotRen) slotRen.addEventListener('click', () => {
    const nm = curSlot();
    if (!nm || BUSY) return;
    const card = currentCharName();
    if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
    askSlotSeq(k.prefix + card + '-', slotSeqText(nm), async raw => {
      if (BUSY) return;
      const num = String(raw || '').replace(/\D/g, '');
      const want = k.prefix + card + (num ? '-' + num : '');
      if (want === nm) { await renderPanel(); return; }
      BUSY = true;
      try {
        const done = await renameSlot(nm, want, kind);
        await renderPanel();
        tip('Số thứ tự mục đã đổi thành: ' + done);
      } catch (e) {
        tip('Đổi tên thất bại: ' + (e && e.message ? e.message : e), true);
      } finally { BUSY = false; }
    });
  });

  const slotDel = d.getElementById('eye-slot-del');
  if (slotDel) slotDel.addEventListener('click', () => {
    const nm = curSlot();
    if (!nm || BUSY) return;
    askConfirm('Xóa mục', 'Bạn có chắc chắn muốn xóa mục "' + nm + '"? Sau khi xóa sẽ không thể khôi phục.', 'Xác nhận xóa', async () => {
      if (BUSY) return;
      BUSY = true;
      try {
        await deleteSlot(currentCharName(), nm, kind);
        MON_PAGE = 1;
        await renderPanel();
        tip('Đã xóa mục: ' + nm);
      } catch (e) {
        tip('Xóa thất bại: ' + (e && e.message ? e.message : e), true);
      } finally { BUSY = false; }
    });
  });

  const slotNew = d.getElementById('eye-slot-new');
  if (slotNew) slotNew.addEventListener('click', async () => {
    if (BUSY) return;
    const card = currentCharName();
    if (!card) { tip('Không lấy được tên thẻ nhân vật hiện tại', true); return; }
    BUSY = true;
    try {
      const made = await newSlot(card, kind, '');
      if (isMon) MON_SEL = null;
      MON_PAGE = 1;
      await renderPanel();
      tip(isMon ? ('Đã tạo mới danh sách trống: ' + made.label)
        : ('Đã tạo mới mục ' + (isWorld ? 'Thiết lập thế giới' : 'Thiết lập nhân vật') + ' trống: ' + made.label));
    } catch (e) {
      tip('Tạo mới thất bại: ' + (e && e.message ? e.message : e), true);
    } finally { BUSY = false; }
  });

  const prev = d.getElementById('eye-prev');
  const next = d.getElementById('eye-next');
  const pageno = d.getElementById('eye-pageno');
  const startJump = () => {
    if (!pageno || d.getElementById('eye-page-input')) return;
    const recs = recordsOf(MON_SEL);
    if (!recs.length) return;
    const i = clampPage(recs.length, MON_PAGE);
    pageno.innerHTML =
      '<input id="eye-page-input" class="eye-page-input" type="text" inputmode="numeric" ' +
      'maxlength="4" value="' + i + '" aria-label="Chuyển đến bản ghi chép chỉ định">';
    const inp = d.getElementById('eye-page-input');
    if (!inp) return;
    inp.focus(); inp.select();
    let settled = false;
    const commit = ok => {
      if (settled) return;
      settled = true;
      if (ok) {
        const v = parseInt(inp.value, 10);
        if (v > 0) MON_PAGE = clampPage(recs.length, v);
      }
      applyFileView(true);
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    inp.addEventListener('blur', () => commit(true));
  };
  if (prev) prev.addEventListener('click', () => { MON_PAGE--; applyFileView(true); });
  if (next) next.addEventListener('click', () => { MON_PAGE++; applyFileView(true); });
  if (pageno) {
    let holdTimer = null;
    const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
    pageno.addEventListener('dblclick', e => { e.preventDefault(); startJump(); });
    pageno.addEventListener('pointerdown', () => { clearHold(); holdTimer = setTimeout(startJump, 420); });
    pageno.addEventListener('pointerup', clearHold);
    pageno.addEventListener('pointerleave', clearHold);
    pageno.addEventListener('pointercancel', clearHold);
  }

  const sw = d.getElementById('eye-sw');
  if (sw) {
    const flip = async () => {
      if (BUSY) return;
      BUSY = true;
      try {
        const wbNow = await getWorldbook(WB_NAME);
        await setMaster(!masterOn(wbNow));
        await renderPanel();
        syncHexNodes();
      } catch (e) {
        tip('Chuyển đổi thất bại: ' + (e && e.message ? e.message : e), true);
      } finally { BUSY = false; }
    };
    sw.addEventListener('click', flip);
    sw.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
    });
  }

  const bindSwitch = (id, fn) => {
    const el = d.getElementById(id);
    if (!el) return;
    const act = async () => {
      if (BUSY) return;
      BUSY = true;
      try {
        const r = await fn();
        if (r === false) return;
        await renderPanel();
        syncHexNodes();
      } catch (e) {
        tip('Chuyển đổi thất bại: ' + (e && e.message ? e.message : e), true);
      } finally { BUSY = false; }
    };
    el.addEventListener('click', act);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); }
    });
  };

  bindSwitch('eye-mod-mon', () => setModOn('mon', !modsMap().mon));
  bindSwitch('eye-mod-set', () => setModOn('set', !modsMap().set));
  bindSwitch('eye-mod-cmd', () => setModOn('cmd', !modsMap().cmd));
  bindSwitch('eye-detach', () => {
    writeLS(DETACH_KEY, detachOn() ? '0' : '1');
    doc.body.classList.toggle('dg-eye-detach', detachOn());
    const pnl = d.getElementById('dg-eye-panel');
    const bl = d.getElementById('dg-eye-ball');
    if (pnl && bl && pnl.style.display !== 'none') placePanel(bl, pnl);
  });
  bindSwitch('eye-power', async () => {
    const wbNow = await getWorldbook(WB_NAME);
    await setPower(!powerOn(wbNow));
  });
  bindSwitch('eye-boost', () => {
    if (readLS(MASTER_KEY) === '0') {
      tip('Cần bật "Toàn Thị Chi Nhãn" trước', true);
      return false;
    }
    if (!boostParts().length) {
      tip('Cần bật "Giám sát" hoặc "Thiết lập" trước', true);
      return false;
    }
    writeLS(BOOST_KEY, boostOn() ? '0' : '1');
  });
  bindSwitch('eye-cover', () => {
    writeLS(COVER_KEY, coverOn() ? '0' : '1');
  });
  bindSwitch('eye-simpleanim', () => {
    writeLS(SIMPLE_KEY, simpleAnimOn() ? '0' : '1');
    const hx = d.getElementById('dg-hex');
    if (hx) hx.classList.toggle('simple', simpleAnimOn());
    if (simpleAnimOn()) stopFx();
  });
}

function bindFileBar(panel) {
  const bd = panel.querySelector('.bd');
  if (!bd) return;
  let holdTimer = null;
  let holding = '';
  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } holding = ''; };
  const chipOf = e => (e.target && e.target.closest) ? e.target.closest('.eye-pchip[data-pick]') : null;
  const doPin = nm => { togglePin(currentCharName(), nm); refreshPersonBar(); };

  bd.addEventListener('click', e => {
    const chip = chipOf(e);
    if (!chip) return;
    const nm = chip.getAttribute('data-pick');
    if (!nm || nm === MON_SEL) return;
    MON_SEL = nm;
    MON_PAGE = 1;
    applyFileView(true);
  });

  bd.addEventListener('dblclick', e => {
    const chip = chipOf(e);
    if (!chip) return;
    e.preventDefault();
    clearHold();
    doPin(chip.getAttribute('data-pick'));
  });

  bd.addEventListener('pointerdown', e => {
    const chip = chipOf(e);
    if (!chip || (e.button != null && e.button !== 0)) return;
    clearHold();
    holding = chip.getAttribute('data-pick');
    holdTimer = setTimeout(() => { holdTimer = null; if (holding) doPin(holding); }, 420);
  });
  bd.addEventListener('pointerup', clearHold);
  bd.addEventListener('pointerleave', clearHold);
  bd.addEventListener('pointercancel', clearHold);

  bd.addEventListener('wheel', e => {
    const bar = e.target && e.target.closest ? e.target.closest('.eye-pbar') : null;
    if (!bar || !e.deltaY || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
}

function bindChips(panel) {
  const bd = panel.querySelector('.bd');
  if (!bd) return;
  let editEl = null;
  let holdTimer = null;
  let dragEl = null;
  let moved = false, sx = 0, sy = 0;
  let swallowClick = false;

  const chipOf = e => (e.target && e.target.closest) ? e.target.closest('.eye-chip') : null;
  const badgeOf = e => (e.target && e.target.closest) ? e.target.closest('.eye-chip-x') : null;
  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
  const setEdit = el => {
    if (editEl && editEl !== el && editEl.isConnected) editEl.classList.remove('editing');
    editEl = (el && el.isConnected) ? el : null;
    if (editEl) editEl.classList.add('editing');
  };

  bd.addEventListener('pointerdown', e => {
    swallowClick = false;
    const chip = chipOf(e);
    if (editEl && (!chip || chip !== editEl)) setEdit(null);
    if (badgeOf(e)) return;
    if (!chip || (e.button != null && e.button !== 0)) return;
    if (chip === editEl) {
      dragEl = chip; moved = false; sx = e.clientX; sy = e.clientY;
      try { chip.setPointerCapture(e.pointerId); } catch (err) {}
      if (e.cancelable) e.preventDefault();
      return;
    }
    clearHold();
    const el = chip;
    holdTimer = setTimeout(() => { holdTimer = null; setEdit(el); }, 420);
  });

  bd.addEventListener('pointermove', e => {
    if (!dragEl || !dragEl.isConnected) return;
    if (!moved) {
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 5) return;
      moved = true;
      dragEl.classList.add('dragging');
    }
    const box = chipsBox();
    if (!box) return;
    let under = null;
    try { under = doc.elementFromPoint(e.clientX, e.clientY); } catch (err) { under = null; }
    const tgt = under && under.closest ? under.closest('.eye-chip') : null;
    if (!tgt || tgt === dragEl || tgt.parentNode !== box) return;
    const r = tgt.getBoundingClientRect();
    box.insertBefore(dragEl, e.clientX > r.left + r.width / 2 ? tgt.nextSibling : tgt);
  });

  const endDrag = e => {
    clearHold();
    if (!dragEl) return;
    const el = dragEl;
    dragEl = null;
    el.classList.remove('dragging');
    try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    if (moved) { persistChipOrder(); swallowClick = true; }
    moved = false;
  };
  bd.addEventListener('pointerup', endDrag);
  bd.addEventListener('pointercancel', endDrag);

  bd.addEventListener('click', e => {
    if (badgeOf(e)) {
      const chip = badgeOf(e).closest('.eye-chip');
      const t = chip ? chip.getAttribute('data-text') : null;
      if (t == null) return;
      const group = chipGroup();
      askConfirm('Xóa ' + group + ' tùy chỉnh', 'Bạn có chắc chắn muốn xóa nội dung này? "' + t + '"', 'Xác nhận xóa', () => {
        const card = currentCharName();
        saveCustoms(card, group, customsOf(card, group).filter(x => x.t !== t));
        if (CUSTOM_EDIT_RAW === t && CUSTOM_EDIT_GROUP === group && CUSTOM_EDIT_CARD === card) clearCustomEdit();
        setEdit(null);
        renderCustomChips();
        tip('Đã xóa');
      });
      return;
    }
    if (swallowClick) { swallowClick = false; return; }
    const chip = chipOf(e);
    if (!chip || chip === editEl) return;
    const t = chip.getAttribute('data-text') || '';
    CUSTOM_EDIT_RAW = t;
    CUSTOM_EDIT_GROUP = chipGroup();
    CUSTOM_EDIT_CARD = currentCharName();
    const cur = customsOf(currentCharName(), chipGroup()).filter(x => x.t === t)[0];
    fillCustom(t, loadedMsg(chipGroup(), (cur && cur.n) || chipTitle(t)));
  });

  bd.addEventListener('dblclick', e => {
    const chip = chipOf(e);
    if (!chip || badgeOf(e)) return;
    if (e.cancelable) e.preventDefault();
    clearHold();
    setEdit(chip);
  });
}

function bindPresets(panel) {
  const bd = panel.querySelector('.bd');
  if (!bd) return;

  bd.addEventListener('click', e => {
    const tab = (e.target && e.target.closest) ? e.target.closest('.eye-tab[data-tab]') : null;
    if (!tab) return;
    const t = tab.getAttribute('data-tab');
    if (!t || t === CMD_TAB) return;
    CMD_TAB = t;
    clearCustomEdit();
    bd.querySelectorAll('.eye-tab[data-tab]').forEach(x => {
      x.classList.toggle('on', x.getAttribute('data-tab') === t);
    });
    const sec = bd.querySelector('.eye-cmd');
    if (sec) sec.setAttribute('data-kind', t);
    const grid = bd.querySelector('#eye-presets');
    if (grid) grid.innerHTML = presetBtnsHtml(t);
    const fold = bd.querySelector('.eye-fold[data-fold="preset"] .eye-fold-t');
    if (fold) fold.textContent = t + ' mặc định';
  });

  bd.addEventListener('click', e => {
    const chip = (e.target && e.target.closest) ? e.target.closest('[data-pre]') : null;
    if (!chip) return;
    const ta = doc.getElementById('eye-cmd');
    if (ta) { ta.value = chip.getAttribute('data-pre'); ta.focus(); }
  });

  bd.addEventListener('click', e => {
    const chip = (e.target && e.target.closest) ? e.target.closest('[data-wpre]') : null;
    if (!chip) return;
    const txt = chip.getAttribute('data-wpre') || '';
    const grp = chip.getAttribute('data-wpg') || '';
    const wpt = chip.getAttribute('data-wpt') || '';
    /* 4 tiêu đề lớn mặc định lấy theo tên nhóm; "Khác" chỉ là phân loại loại trừ ở frontend chứ không phải tiêu đề lớn,
       các mục loại này dùng chính tiêu đề của nó làm tiêu đề lớn. */
    const head = presetHead(grp, wpt);
    if (txt.indexOf('\n') >= 0) {
      const p = compParse(txt);
      COMP_KIND = SET_TAB === 'pers' ? 'pers' : 'world';
      if (head && COMP_KIND === 'world') WORLD_HEAD = head;
      COMP_EDIT = '';
      COMP_IDX = -1;
      COMP_BLOCK = '';
      COMP_HEAD = COMP_KIND === 'pers' ? (MON_SEL || '') : (p.head || wpt || '');
      COMP_ROWS = p.rows.length ? p.rows : [{ t: '', x: '', d: 1 }];
      COMP_CUR = -1;
      COMP_OPEN = true;
      renderPanel().then(() => {
        const f = doc.querySelector('.eye-fold[data-fold="wpreset"], .eye-fold[data-fold="pperset"]');
        if (f) f.classList.add('open');
        compScroll();
      }, compScroll);
      return;
    }
    const fill = () => {
      const ti = doc.getElementById('eye-new-t');
      const inp = doc.getElementById('eye-new');
      if (ti) ti.value = wpt;
      if (inp) { inp.value = txt; inp.focus(); }
    };
    if (!head || String(WORLD_HEAD || '').trim() === head) { fill(); return; }
    WORLD_HEAD = head;
    renderPanel().then(() => {
      const f = doc.querySelector('.eye-fold[data-fold="wpreset"]');
      if (f) f.classList.add('open');
      fill();
    }, fill);
  });

  bd.addEventListener('click', e => {
    const h = (e.target && e.target.closest) ? e.target.closest('[data-htab]') : null;
    if (!h) return;
    const t = h.getAttribute('data-htab');
    if (!t || t === HELP_TAB) return;
    HELP_TAB = t;
    renderPanel();
  });
}

function refreshPersonBar() {
  const d = doc;
  const el = d.querySelector('#dg-eye-panel .eye-people');
  if (!el) return;
  const watch = WATCH_CACHE || [];
  if (!watch.length) return;
  el.outerHTML = personBarHtml(watch, currentCharName());
  applyFileView(true);
}

function settingSendText(raw) {
  const s = String(raw == null ? '' : raw).replace(/^[ \t]+/, '').replace(/^[-*·]\s*/, '').trim();
  if (!s) return '';
  return splitHead(s) || s;
}

/* Tạo thiết lập: Trigger Word + Yêu cầu do người dùng viết, cùng đặt vào thanh nhập chat, không tự động gửi đi */
/* Trong thẻ trước tiên đặt nguyên văn câu người dùng viết, tiếp theo là 5 phần thông tin, cuối cùng đóng thẻ lại.
   Nếu tên để trống thì không ghi dòng đó, 4 mục còn lại luôn có giá trị. */
function genSendText(req) {
  const lines = [req];
  const nm = String(GEN_OPTS.name || '').trim();
  if (nm) lines.push('Tên thiết lập: ' + nm);
  lines.push('Loại thiết lập: ' + GEN_OPTS.kind);
  lines.push('Phạm vi thiết lập: ' + GEN_OPTS.scope);
  lines.push('Thiết lập NSFW: ' + GEN_OPTS.nsfw);
  lines.push('State machine: ' + GEN_OPTS.fsm);
  return '<Toàn Thị Chi Nhãn_Tạo thiết lập>\n' + lines.join('\n') + '\n</Toàn Thị Chi Nhãn_Tạo thiết lập>';
}

function doGenSend() {
  const d = doc;
  const ta = d.getElementById('eye-gen-text');
  const s = ta ? String(ta.value || '').trim() : '';
  if (!s) { tip('Hãy viết yêu cầu thiết lập cần tạo trước', true); return; }
  const box = d.getElementById('send_textarea');
  if (!box) { tip('Không tìm thấy thanh nhập chat', true); return; }

  const txt = genSendText(s);
  const cur = box.value || '';
  box.value = cur.trim() ? cur.replace(/\s+$/, '') + '\n' + txt : txt;
  try {
    const P = window;
    box.dispatchEvent(new (P.Event || Event)('input', { bubbles: true }));
  } catch (e) {}
  try { box.focus(); box.selectionStart = box.selectionEnd = box.value.length; } catch (e) {}
  tip('Đã nối vào thanh nhập chat');
  const panel = d.getElementById('dg-eye-panel');
  if (panel && panel.style.display !== 'none') panel.style.display = 'none';
}

function doSendSetting(raw) {
  const d = doc;
  const t = settingSendText(raw);
  if (!t) { tip('Mục này không có nội dung để gửi', true); return; }
  const box = d.getElementById('send_textarea');
  if (!box) { tip('Không tìm thấy thanh nhập chat', true); return; }

  const txt = '<Toàn Thị Chi Nhãn_Kích hoạt thiết lập ghi đè>\n' + t + '\n</Toàn Thị Chi Nhãn_Kích hoạt thiết lập ghi đè>';
  const cur = box.value || '';
  box.value = cur.trim() ? cur.replace(/\s+$/, '') + '\n' + txt : txt;
  try {
    const P = window;
    box.dispatchEvent(new (P.Event || Event)('input', { bubbles: true }));
  } catch (e) {}
  try { box.focus(); box.selectionStart = box.selectionEnd = box.value.length; } catch (e) {}
  tip('Đã nối vào thanh nhập chat');
  const panel = d.getElementById('dg-eye-panel');
  if (panel && panel.style.display !== 'none') panel.style.display = 'none';
}

async function doSend() {
  if (BUSY) return;
  const d = doc;
  const sel = d.getElementById('eye-target');
  const ta = d.getElementById('eye-cmd');
  const name = (sel && sel.value ? sel.value : '').trim();
  const cmd = ta && ta.value.trim();
  if (!name) { tip('Vui lòng điền tên đối tượng trước', true); return; }
  if (!cmd) { tip('Nội dung chỉ thị đang trống', true); return; }

  const box = d.getElementById('send_textarea');
  if (!box) { tip('Không tìm thấy thanh nhập chat', true); return; }

  BUSY = true;
  const btn = d.getElementById('eye-send');
  if (btn) btn.style.opacity = '.45';
  try {
    const txt = '<Toàn Thị Chi Nhãn_Chỉ thị tối cao>\nĐối tượng: ' + name + '\nChỉ thị: ' + cmd + '\n</Toàn Thị Chi Nhãn_Chỉ thị tối cao>';
    const cur = box.value || '';
    box.value = cur.trim() ? cur.replace(/\s+$/, '') + '\n' + txt : txt;
    try {
      const P = window;
      box.dispatchEvent(new (P.Event || Event)('input', { bubbles: true }));
    } catch (e) {}
    try { box.focus(); box.selectionStart = box.selectionEnd = box.value.length; } catch (e) {}
    CMD_BASE = getChat().length || 0;
    PENDING_CMD = { name: name, cmd: cmd };
    tip('Đã nối vào thanh nhập chat');
    if (ta) ta.value = '';
    const panel = d.getElementById('dg-eye-panel');
    if (panel && panel.style.display !== 'none') panel.style.display = 'none';
    refresh();
  } catch (e) {
    tip('Nối nội dung thất bại: ' + (e && e.message ? e.message : e), true);
  } finally {
    BUSY = false;
    if (btn) btn.style.opacity = '';
  }
}

function syncBall() {
  if (!doc.getElementById('dg-eye-ball')) return;
  if (PENDING_CMD && getChat().length > CMD_BASE + 1) PENDING_CMD = null;
}

function syncBar(panel) {
  const bar = panel.querySelector('.dg-eye-bar');
  if (!bar) return;
  if (PENDING_CMD && PENDING_CMD.name) {
    bar.style.display = 'block';
    bar.innerHTML = '<span class="lb">Chỉ thị tối cao</span>' + esc(PENDING_CMD.name) + ' &mdash; ' + esc(PENDING_CMD.cmd || '');
  } else {
    bar.style.display = 'none';
  }
}

function refresh() {
  const ball = doc.getElementById('dg-eye-ball');
  const panel = doc.getElementById('dg-eye-panel');
  if (!ball || !panel) return;
  syncBall();
  if (panel.style.display === 'none') return;
  syncBar(panel);
  renderPanel();
}

function restorePos(ball) {
  let p = null;
  try { p = JSON.parse(window.localStorage.getItem(EYE_KEY) || 'null'); } catch (e) {}
  const w = window.innerWidth, h = window.innerHeight;
  const x = p && typeof p.x === 'number' ? Math.min(Math.max(p.x, 0), w - RADIUS * 2) : w - RADIUS * 2 - 24;
  const y = p && typeof p.y === 'number' ? Math.min(Math.max(p.y, 0), h - RADIUS * 2) : Math.round(h * 0.42);
  ball.style.left = x + 'px';
  ball.style.top = y + 'px';
}

function savePos(ball) {
  try {
    window.localStorage.setItem(EYE_KEY, JSON.stringify({
      x: parseInt(ball.style.left, 10) || 0,
      y: parseInt(ball.style.top, 10) || 0,
    }));
  } catch (e) {}
}

function snap(ball) {
  const w = window.innerWidth, h = window.innerHeight;
  const d = RADIUS * 2;
  let x = parseInt(ball.style.left, 10) || 0;
  let y = parseInt(ball.style.top, 10) || 0;

  x = Math.min(Math.max(x, 0), w - d);
  y = Math.min(Math.max(y, 0), h - d);

  if (x < SNAP_PX) x = 0;
  else if (x > w - d - SNAP_PX) x = w - d;

  ball.style.left = x + 'px';
  ball.style.top = y + 'px';
  savePos(ball);
}

function savePanelPos(panel) {
  writeLS(PPOS_KEY, JSON.stringify({
    x: parseInt(panel.style.left, 10) || 0,
    y: parseInt(panel.style.top, 10) || 0,
  }));
}

function readPanelPos() {
  try { return JSON.parse(readLS(PPOS_KEY) || 'null'); } catch (e) { return null; }
}

function clampPanel(panel) {
  const w = window.innerWidth, h = window.innerHeight;
  const pw = panel.offsetWidth || 340;
  const ph = panel.offsetHeight || 300;
  let x = parseInt(panel.style.left, 10) || 0;
  let y = parseInt(panel.style.top, 10) || 0;
  x = Math.min(Math.max(x, 8), Math.max(8, w - pw - 8));
  y = Math.min(Math.max(y, 8), Math.max(8, h - ph - 8));
  panel.style.left = x + 'px';
  panel.style.top = y + 'px';
}

function placePanel(ball, panel) {
  if (detachOn()) {
    const p = readPanelPos();
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
      panel.style.left = p.x + 'px';
      panel.style.top = p.y + 'px';
      clampPanel(panel);
      return;
    }
  }
  const d = RADIUS * 2;
  const x = parseInt(ball.style.left, 10) || 0;
  const y = parseInt(ball.style.top, 10) || 0;
  const pw = panel.offsetWidth || 340;
  const ph = panel.offsetHeight || 300;
  const gap = 12;
  let px = x + d + gap;
  if (px + pw > window.innerWidth - 8) px = Math.max(8, x - pw - gap);
  let py = Math.min(Math.max(y - 20, 8), window.innerHeight - ph - 8);
  panel.style.left = px + 'px';
  panel.style.top = py + 'px';
  if (detachOn()) savePanelPos(panel);
}

function makePanelDraggable(panel) {
  const hd = panel.querySelector('.hd');
  if (!hd) return;
  let sx = 0, sy = 0, px = 0, py = 0, on = false;
  hd.addEventListener('pointerdown', e => {
    if (!detachOn() || e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('.x')) return;
    sx = e.clientX; sy = e.clientY;
    px = parseInt(panel.style.left, 10) || 0;
    py = parseInt(panel.style.top, 10) || 0;
    on = true;
    hd.classList.add('dragging');
    try { hd.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  hd.addEventListener('pointermove', e => {
    if (!on) return;
    panel.style.left = (px + e.clientX - sx) + 'px';
    panel.style.top = (py + e.clientY - sy) + 'px';
  });
  const end = e => {
    if (!on) return;
    on = false;
    hd.classList.remove('dragging');
    try { hd.releasePointerCapture(e.pointerId); } catch (err) {}
    clampPanel(panel);
    savePanelPos(panel);
  };
  hd.addEventListener('pointerup', end);
  hd.addEventListener('pointercancel', end);
}

const DRAG = { moved: false };

function makeDraggable(ball, panel) {
  let sx = 0, sy = 0, bx = 0, by = 0;

  ball.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    DRAG.moved = false;
    sx = e.clientX; sy = e.clientY;
    bx = parseInt(ball.style.left, 10) || 0;
    by = parseInt(ball.style.top, 10) || 0;
    ball.classList.add('dragging');
    ball.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  ball.addEventListener('pointermove', e => {
    if (!ball.classList.contains('dragging')) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!DRAG.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    DRAG.moved = true;
    ball.style.left = (bx + dx) + 'px';
    ball.style.top = (by + dy) + 'px';
    placeHex(ball);
  });

  const end = e => {
    if (!ball.classList.contains('dragging')) return;
    ball.classList.remove('dragging');
    try { ball.releasePointerCapture(e.pointerId); } catch (err) {}
    snap(ball);
    placeHex(ball);
    if (panel.style.display !== 'none') placePanel(ball, panel);
    if (!DRAG.moved) toggleHex(ball);
  };
  ball.addEventListener('pointerup', end);
  ball.addEventListener('pointercancel', end);

  EYE_ONRESIZE = () => {
    snap(ball);
    placeHex(ball);
    if (panel.style.display !== 'none') placePanel(ball, panel);
  };
  window.addEventListener('resize', EYE_ONRESIZE);
}

let EYE_ONDEL = null;

function boot() {
  teardown();
  build();
  if (!EYE_ONDEL) {
    try {
      const ctx = getCtx();
      if (ctx && ctx.eventSource && ctx.eventTypes && ctx.eventTypes.MESSAGE_DELETED) {
        EYE_ONDEL = () => {
          DISK_CHAT.key = '';
          DISK_CHAT.list = null;
          DISK_CHAT.fail = true;
          DISK_CHAT.at = Date.now();
          MH_CACHE = { at: 0, len: -1, dlen: -2, out: null };
        };
        ctx.eventSource.on(ctx.eventTypes.MESSAGE_DELETED, EYE_ONDEL);
      }
    } catch (e) {}
  }
  try { eyeBoostHook(); } catch (e) {}
  try { loadList(currentCharName(), 'mon').then(l => { WATCH_CACHE = (l && l.names) || []; }).catch(() => {}); } catch (e) {}
  EYE_INTERVAL = setInterval(() => {
    try { checkCardScope(); } catch (e) {}
    const pnl = doc.getElementById('dg-eye-panel');
    if (pnl && pnl.style.display !== 'none') {
      syncBall();
      syncBar(pnl);
      refreshMonitorOnly();
      return;
    }
    refresh();
  }, 1200);
  EYE_ONUNLOAD = () => teardown();
  EYE_ONPAGEHIDE = () => teardown();
  window.addEventListener('beforeunload', EYE_ONUNLOAD);
  window.addEventListener('pagehide', EYE_ONPAGEHIDE);
}

function eyeOldScriptOn() {
  try {
    const ctx = eyeCtx();
    const th = ctx && ctx.extensionSettings && ctx.extensionSettings.tavern_helper;
    const list = th && th.script && Array.isArray(th.script.scripts) ? th.script.scripts : null;
    if (!list) return false;
    for (const s of list) {
      if (s && s.name === 'Toàn Thị Chi Nhãn' && s.enabled) return true;
    }
  } catch (e) {}
  return false;
}

function eyeStart(tries) {
  const n = tries || 0;
  if (!window.SillyTavern || typeof window.SillyTavern.getContext !== 'function') {
    if (n < 40) { setTimeout(() => eyeStart(n + 1), 250); return; }
    console.error('[Toàn Thị Chi Nhãn] Tavern chưa sẵn sàng, từ bỏ khởi động');
    return;
  }
  if (eyeOldScriptOn()) {
    console.warn('[Toàn Thị Chi Nhãn] Script cùng tên trong Tavern Assistant vẫn đang được kích hoạt, extension tạm thời không khởi động (tránh trùng hai bóng nổi). Tắt script đó đi rồi tải lại trang là được.');
    return;
  }
  try { boot(); } catch (e) { console.error('[Toàn Thị Chi Nhãn] Khởi động thất bại', e); }
  try { eyeMountInstaller(0); } catch (e) { console.error('[Toàn Thị Chi Nhãn] Gắn danh sách cài đặt thất bại', e); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => eyeStart(0), { once: true });
} else {
  eyeStart(0);
}