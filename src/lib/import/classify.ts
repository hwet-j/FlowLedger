import { merchantKey } from '../merchants';

/** 가맹점 키워드 → 분류 id (시드 카테고리 id). 사용자가 학습시킨 분류(merchant_categories)가 항상 우선한다 */
const EXPENSE_WORDS: [string, string[]][] = [
  ['cat_food_cafe', ['스타벅스', '이디야', '투썸', '메가커피', '메가mgc', '빽다방', '컴포즈', '할리스', '폴바셋', '탐앤탐스', '공차', '파리바게뜨', '파리바게트', '뚜레쥬르', '던킨', '배스킨', '설빙', '카페', '커피', '베이커리', '제과']],
  ['cat_food_delivery', ['배달의민족', '우아한형제들', '배민', '요기요', '쿠팡이츠', '땡겨요']],
  ['cat_food_grocery', ['이마트', '홈플러스', '롯데마트', '코스트코', '하나로마트', '마켓컬리', '컬리', 'ssg', '쓱', 'gs25', 'cu', '씨유', '세븐일레븐', '이마트24', '미니스톱', '편의점', '농협하나로', '정육점', '청과', '식자재']],
  ['cat_food_eat_out', ['맥도날드', '버거킹', '롯데리아', '맘스터치', '서브웨이', '본죽', '아웃백', '빕스', '하남돼지', '식당', '치킨', '피자', '김밥', '분식', '국밥', '곱창', '횟집', '초밥', '스시', '샤브', '설렁탕', '냉면', '족발', '보쌈', '파스타', '쌀국수', '도시락', '칼국수', '순대', '한식', '중식', '일식', '삼겹', '갈비', '고기', '짜장', '반점', '부대찌개', '감자탕', '곰탕', '해장', '포차', '술집', '호프']],
  ['cat_transport_taxi', ['카카오t', '카카오택시', '택시', '우티', 'uber', '타다']],
  ['cat_transport_public', ['티머니', '지하철', '서울교통공사', '코레일', '한국철도', '버스', '시외버스', '고속버스', '캐시비', '교통카드', 'srt', 'ktx', '후불교통']],
  ['cat_transport_fuel', ['주유소', 'sk에너지', 'gs칼텍스', '에쓰오일', 's-oil', 'soil', '현대오일뱅크', '알뜰주유', '주차', '하이패스', '한국도로공사', '주유', '세차']],
  ['cat_hobby_sub', ['넷플릭스', '유튜브', '유튜브프리미엄', '멜론', '스포티파이', '왓챠', '티빙', '웨이브', '디즈니', '쿠팡플레이', '구독', '멤버십', 'apple.com/bill', 'icloud', '네이버플러스']],
  ['cat_hobby_game', ['스팀', 'steam', '넥슨', '엔씨소프트', '플레이스테이션', '닌텐도', '블리자드', '게임']],
  ['cat_hobby_culture', ['cgv', '메가박스', '롯데시네마', '영화', '인터파크', '교보문고', '알라딘', '예스24', 'yes24', '공연', '티켓', '서점', '전시', '미술관']],
  ['cat_hobby_sports', ['헬스', '피트니스', '필라테스', '요가', '수영', '골프', '스크린', '볼링', '클라이밍', '체육']],
  ['cat_hobby_travel', ['호텔', '야놀자', '여기어때', '에어비앤비', '대한항공', '아시아나', '제주항공', '티웨이', '진에어', '아고다', '부킹닷컴', '트립', '항공', '리조트', '펜션']],
  ['cat_housing_phone', ['skt', 'sk텔레콤', 'kt', '케이티', 'lg유플러스', '엘지유플러스', '알뜰폰', '통신요금', '통신']],
  ['cat_housing_utility', ['한국전력', '한전', '도시가스', '서울도시가스', '수도요금', '전기요금', '가스요금', '상수도', '공과금']],
  ['cat_housing_mgmt', ['관리비', '아파트관리', '관리사무소']],
  ['cat_housing_rent', ['월세', '임대료']],
  ['cat_health_hospital', ['병원', '의원', '약국', '치과', '한의원', '클리닉', '안과', '정형외과', '피부과', '이비인후과', '내과', '소아과', '의료원', '건강검진']],
  ['cat_shop_clothes', ['무신사', '지그재그', '에이블리', '유니클로', '자라', 'zara', 'h&m', '나이키', '아디다스', '탑텐', '스파오', '의류', '패션', '아울렛']],
  ['cat_shop_living', ['쿠팡', '다이소', '올리브영', '이케아', '오늘의집', '11번가', '지마켓', '옥션', '네이버페이', '생활용품', '무인양품', '노브랜드']],
  ['cat_shop_elec', ['삼성전자', '하이마트', '일렉트로마트', '전자랜드', '애플스토어', '쿠팡로켓', '컴퓨존', '다나와']],
  ['cat_finance_insurance', ['삼성화재', '현대해상', 'db손해', '메리츠', 'kb손해', '한화생명', '삼성생명', '교보생명', '보험']],
  ['cat_finance_fee', ['수수료', '이자']],
  ['cat_edu', ['학원', '인프런', '클래스101', '패스트캠퍼스', '학습지', '교육', '강의', '유데미']],
  ['cat_gift', ['경조', '축의', '부조', '선물', '기프티콘', '카카오톡선물']],
];
const INCOME_WORDS: [string, string[]][] = [
  ['cat_salary', ['급여', '월급', '상여', '보너스']],
  ['cat_interest', ['이자', '배당']],
  ['cat_refund', ['환불', '취소', '환급', '반품']],
  ['cat_allowance', ['용돈']],
];

const normText = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\-_.·*#()[\]]/g, '');

export type ClassifySource = 'learned' | 'keyword' | null;
export interface Classified { category_id: string | null; source: ClassifySource }

/** 가맹점/적요 → 분류. 학습(정확 일치 > 키 포함)이 사전보다 우선. ids 가 주어지면 그 안에 있는 분류만 돌려준다 */
export function classify(description: string, type: 'expense' | 'income', learned?: ReadonlyMap<string, string>, ids?: ReadonlySet<string>): Classified {
  const key = merchantKey(description);
  const ok = (id: string) => !ids || ids.has(id);
  if (key && learned) {
    const exact = learned.get(key);
    if (exact && ok(exact)) return { category_id: exact, source: 'learned' };
    for (const [k, id] of learned) if (k.length >= 3 && key.length > k.length && key.startsWith(k) && ok(id)) return { category_id: id, source: 'learned' };
  }
  const t = normText(description);
  if (!t) return { category_id: null, source: null };
  for (const [id, words] of type === 'income' ? INCOME_WORDS : EXPENSE_WORDS) {
    if (words.some((w) => t.includes(normText(w))) && ok(id)) return { category_id: id, source: 'keyword' };
  }
  return { category_id: null, source: null };
}

export type TransferKind = 'card_bill' | 'atm' | 'saving' | 'self' | 'wallet_topup';
const TRANSFER_HINTS: [TransferKind, RegExp][] = [
  ['card_bill', /카드대금|카드결제대금|카드값|카드출금|(?:신한|삼성|현대|국민|kb|롯데|하나|우리|bc|nh|농협|씨티)카드(?:대금|결제|출금|자동)|카드자동이체/i],
  ['atm', /현금인출|atm|cd기|현금서비스|출금기/i],
  ['saving', /적금|예금납입|청약|펀드|증권|투자이체|연금저축|isa/i],
  ['wallet_topup', /페이머니충전|카카오페이충전|네이버페이충전|토스머니|토스충전|충전/],
  ['self', /본인|내계좌|내통장|자기앞|계좌이체\(본인\)|나에게/],
];

export const TRANSFER_LABEL: Record<TransferKind, string> = {
  card_bill: '카드 대금 (카드 내역과 이중 집계될 수 있어요)', atm: '현금 인출', saving: '저축·투자 이동', self: '내 계좌 간 이동', wallet_topup: '페이 충전',
};

/** 내부 이동(지출이 아닐 수 있는 거래)으로 보이는지 */
export function transferHint(description: string): TransferKind | null {
  const t = description.normalize('NFKC').replace(/\s+/g, '');
  for (const [kind, re] of TRANSFER_HINTS) if (re.test(t)) return kind;
  return null;
}
