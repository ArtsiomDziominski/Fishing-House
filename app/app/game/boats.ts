// Лодки у причала — только картинка на воде, как течение реки и погода: на ходьбу и рыбалку не влияют, в рюкзак не кладутся.
// Четыре вида по числу мест (BOAT_ART[1..4]) — пиксельные карты, как у вещей (items-art.ts): буква — цвет из pal, точка — пусто.
// Как на картинке-образце: маленькая вёсельная лодка, побольше, ещё больше и рыбацкое судно с рубкой и мачтой.
// Нарисованы 1:1 в арт-пикселях карты, сверху в три четверти и наискось — носом вверх-вправо, вдоль краёв причала;
// голубые точки снизу — блики воды у борта.
// Где какая стоит — BERTHS. Лодка чуть покачивается на воде; дождь по ней не рисует кругов (её пиксели вычеркнуты из маски воды).

export type BoatKind = 1 | 2 | 3 | 4;
export interface BoatArt { pal: Record<string, string>; map: string[] }

// Места у причала: x, y — середина нижнего края картинки (у воды), в пикселях карты 640×360; flip — носом вверх-влево.
// Чтобы переставить или сменить лодку, достаточно поправить эту строку. Вёсельная лодка — та, на которой плывут на остров:
// садятся в неё с края мостков (BOAT_AT в shared/src/rules.ts), поэтому она стоит вплотную к ним.
export const BERTHS: { kind: BoatKind; x: number; y: number; flip?: boolean }[] = [
  { kind: 2, x: 341, y: 327 },   // справа у мостков, в стороне от лески рыбака: на ней плывут на остров
  { kind: 4, x: 458, y: 364 },   // правее: рыбацкое судно у берега
];
export const FERRY = BERTHS[0]!;   // лодка на остров

export const BOAT_ART: Record<BoatKind, BoatArt> = {
  1: {   // одноместная: маленькая вёсельная лодка, одна банка, сиденье на корме и площадка на носу
    pal: { A: 'c4824a', F: '57291a', H: 'a8693a', J: '4e2416', K: '673420', L: 'd8f0f8', R: 'eab577', S: 'd69454', T: 'f0b878', d: '45200f', f: '6c3721', h: '8e4f2d', k: '2e1209', l: '9fd4e8', o: '1c0806', p: '5e2d1b', s: '8e4c27' },
    map: [
      '......................oooooooooooo..',
      '..................oooohRRRRRRRRRhAo.',
      '...............ooohRRAAAAAAAAAAAARRo',
      '.............ookRAAAAAAkkkkkkkkkkRRo',
      '...........ooRRkAAAkkkkKKKKKKKKKKRHo',
      '.........ooRAAAAkkkKKKKKKKKKKKKKKRho',
      '........oRAAAAkkKKKKKKKKKKsSSSSSKHpo',
      '......ooRAAAkkKKKSTKKKKKKKkSSSSSARHo',
      '.....ohAAAkkKKKSSSTTKKKKKKKsSSSSARho',
      '....oRAAAkKKKKKSSSSTKJFFFFFksSSSRRdo',
      '...ohRAAkKKKKKKsSSSSTFFFFFFFksSARHol',
      '..ohRAAkKKKKKKKksSSSSTFFFFFffkSARho.',
      '.ohRAkkKKKKKKJFFkSSSSTTFFffffFAHHpo.',
      'ohRAAKKKKKKJFFFFksSSSSTffffFFFRhhdo.',
      'ohRAkKKKKKFFFFFFFksSSSSTfFFFFRHpdol.',
      'ophkKTKKKFFFFFFFFFksSSSSTFFFAHhHo...',
      'ohhhKTTJFFFFFFFFfffkSSSSSTFAHhpdo...',
      'ohphhSTTFFFFFFfffffFkSSSSTkRhpdoL...',
      'odhphhSTTFFFFffffFFFksSSARHHpdo.....',
      'lohhphSSTFFffffFFFFFFkAARHhhdol.....',
      '.ophhphSSTfffFFFFFFFAARRHhpdol......',
      '.ohphhhhSSTFFFFFFAARRHHHhddo........',
      '.odhphphAAAAAAAARRHHHhhhdooL........',
      '..ohhphKhHHHHHHHHHhhhddool..........',
      '..odhhhhhhhhhhhhhhpddoo.l...........',
      '..Lophphpppppppppddoo.L.............',
      '...odphphHHHHddddooll...............',
      '....odhhhddddooooL..................',
      '....lodddoooo.ll....................',
      '.....loooll.L.......................',
      '.......L............................',
    ],
  },
  2: {   // двухместная вёсельная лодка, на ней плывут на остров: острый нос с наклонным форштевнем, плоский транец на корме,
         // обшивка внахлёст поясами, низ просмолён; внутри шпангоуты по борту, слани, две банки и сиденье на корме;
         // весло в уключине ближнего борта: рукоять внутри над банкой, лопасть лежит на воде; под бортом — тень и блики
    pal: { A: 'c4824a', d: '45200f', F: '57291a', f: '6c3721', H: 'a8693a', h: '8e4f2d', J: '4e2416', K: '673420', k: '2e1209', L: 'd8f0f8', l: '9fd4e8', O: 'e6b373', o: '1c0806', P: 'c88a4c', p: '5e2d1b', R: 'eab577', S: 'd69454', s: '8e4c27', T: 'f0b878', w: '2d527c' },
    map: [
      '............................................ooo.....',
      '........................................ooooTTTo....',
      '.....................................oooTTRRRRRo....',
      '..................................oooTTRRRRkRRo.....',
      '................................ooTTRRRRkkkkRRo.....',
      '.............................oooTRRRRkkkkKKkRRo.....',
      '...........................ooTRRRRkkkkJKKKKRRo......',
      '........................oooTRRRkkkkKKKJJKKKRRo......',
      '.....................oooTRRRRkkkkJKKKKKJKKRRHo......',
      '....................okTRRRRkkkKKKJKKKKKJKKRRo.......',
      '..................ooTRRRkkkTKKKKKJKKKKKJKRRRo.......',
      '.................oTRRRkkkSSSTTKKKJKKKKKJKRRho.......',
      '...............ooTRRRkkKKsSSSSTKKJKKKKKJRRRo........',
      '..............oTRRRkkKJKKKsSSSSTOJJKKKFKRRpo........',
      '.............oTRRkkKKKJKKKKsSSSSOOJFFFJRRRho........',
      '...........ooTRRkkJKKKKJKKKKJsSSSOOTFFFRRpo.........',
      '..........oTTRRkKKJKKKKJKKKFFJsSSOOOTfRRHho.........',
      '.........oTRRkkSTKJKKKKJKFFJJFffsSOOSRRRhdo.........',
      '........oTRRkkSSSTJKKKJFFFFFFfffFsSOORRAho..........',
      '.......oTRRkkKSSSSSTJJFFJFFJffJFFffskOHhdo..........',
      '......oTTRkkKKssSSSSTffFFFffJFFJfffROOOdo...........',
      '.....oTRRkkKKKJKsSSSSSTFJffJFFfffFRRROOo............',
      '....oTTRkKJKKKKJJssSSSSTffFFJffJFRRRppOOo...........',
      '...oTRRkKKKKKKJJFfJsSSSSSTFfffFFRRRApdoOOo..........',
      '..oTRRkJKKKJKJFFfFFFssSSSSTfJFRRRRphhooOOOo.........',
      '.oRRRkSTKKKJJFffFFJffJsSSSSSTRRRHphhdowoOOo.........',
      '..oRRJSSTKKFFfJFFffJFFFssSSRRRRHpphdol.woOOo........',
      '..oHRRRSSSTFFFFffffFFJffJsRRRHAhphdol...woOOo.......',
      '..oHHHRRJSSTFJfffFFJfffFRRRRHphhddow.....woOOo......',
      '..opHHHRRRSSSTfFFFJfffRRRRHAhphddow.......oOOPo.....',
      '..ohpHHHHRRJSSSFFfffRRRRHAphhhdoow........oOOPPo....',
      '..ohhhpHHHRRRSSTTRRRRRHAphphddowl.........loOOPOo...',
      '...odhhpHHHHRRJRRRRRHAphphhdoow............loOOPOo..',
      '...wodhhhpHHHRRRRHHAphphhddowL..............LoOOPo..',
      '....woddhhpHHHHHApphphhddoow.................oOOPPo.',
      '.....woodhhhpHpphhphhddoowl..................woOOPo.',
      '......wloddhhpphphhddooww.....................wooo..',
      '........loodhhhhhddoolw........................wlw..',
      '.........Lwodddddoolw...............................',
      '...........woddoowl.................................',
      '............woowL...................................',
      '.............ww.....................................',
    ],
  },
  3: {   // трёхместная: длинная вёсельная лодка, три банки
    pal: { A: 'c4824a', F: '57291a', H: 'a8693a', J: '4e2416', K: '673420', L: 'd8f0f8', R: 'eab577', S: 'd69454', T: 'f0b878', d: '45200f', f: '6c3721', h: '8e4f2d', k: '2e1209', l: '9fd4e8', o: '1c0806', p: '5e2d1b', s: '8e4c27' },
    map: [
      '........................................oooooooooooooo..',
      '..................................oooooohRRRRRRRRRRRhAo.',
      '...............................oookhRRAAAAAAAAAAAAAAAARo',
      '............................ooohRRkAAAAAAkkkkkkkkkkkkARo',
      '.........................ooohRAAAAAAkkkkkKKKKKKKKKKKKAHo',
      '.......................oohRAAAAAAkkkKKKKKKKKKKKKKKKKKRho',
      '.....................ooRRAAAAkkkkKKKKKKKKKKKKKKKKKKKKRRo',
      '...................ooRRAAAAkkKKKKKKKKKKKKKKSSSSSSSSSKRHo',
      '.................ooRRAAAkkkKKKKKKKSSSTKKKKKSSSSSSSSSARho',
      '...............ooRAAAAkkKKKKKKKKKSSSSTTKKKKkSSSSSSSSRRpo',
      '..............oRRAAAkkKKKKKTTKKKKkSSSSTTKKKKsSSSSSSSHHHo',
      '............ooRAAAkkKKKKKSSSTKKKKKsSSSSTFFFFksSSSSSARhho',
      '...........oRAAAAkKKKKKKSSSSTTKKKJksSSSSTFFFFkSSSSSRHppo',
      '..........ohAAAkkKKKKKKKkSSSSTTFFFFkSSSSTTFFFFkSSSARhHHo',
      '.........oRRAAkKKKKTKKKKKsSSSSTTFFFksSSSSTTFffksSARRphdo',
      '........oRAAkkKKKSSTKKKKJksSSSSTFFFFksSSSSTTffFksRRHHdol',
      '......ooRAAkKKKKSSSSTKKJFFkSSSSSTFFFFksSSSSTFFFFAHHhho..',
      '.....ohRAAkKKKKKSSSSTTFFFFksSSSSTTFFFFkSSSSSTFFFRhhpdo..',
      '....ohRAAkKKKKKKsSSSSTTFFFFksSSSSTTFffksSSSSTTFRHppdoL..',
      '...ohRAkkKKKKKKKksSSSSTFFFFFksSSSSTfffFksSSSSTkHhHdo....',
      '..ohRAAKKKKKKKKKJksSSSSTFFFFFkSSSSSTfFFFksSSSAHhpdol....',
      '.ohRAkkKKKKKKKJFFFkSSSSSTFFFFFkSSSSTTFFFFkSSARhpdol.....',
      'ohhAkKKKTKKKKJFFFFksSSSSTTFFffksSSSSTTFFFFkARHpdo.......',
      'ohpkKKKTTKKKFFFFFFFksSSSSTfffffksSSSSTFFFFAHHhdoL.......',
      'lohhKKSSSTKFFFFFFFFFksSSSSTfFFFFkSSSSSTFAAHhhdo.........',
      '.ohhhSSSSTTFFFFFFFFFFkSSSSSTFFFFFkSSSSSARRhpdol.........',
      '.opphhSSSSTTFFFFFFFFFksSSSSTTFFFFksSSSARHHpdol..........',
      '.ohhphSSSSSTFFFFFFFfffksSSSSTTFFFFksARRHhhdo............',
      '.ohhhphSSSSSTFFFfffffFFksSSSTTFFFFARRHHhdooL............',
      '.odphhhhSSSSTTFffffFFFFFkSSSSTTFARRHHhhdol..............',
      '.lohphphhSSSSTTfFFFFFFFFFkSSSSARRHHhhdool...............',
      '..ohhphphSSSSSTFFFFFFFFFFksARRRHHhhddoL.................',
      '..ophhhhphSSSSSTFFFFFFFAARRRHHHhhddoo...................',
      '..odphphhhhSSSSSTFFAARRRHHHHhhhddooll...................',
      '...ohphphphRRRRRRRHHHHHHhhhhpddooL......................',
      '...odhhhphphHHHHHHhhhhhhppdddool........................',
      '...Lodphhhhhhhhhhhpppppdddooo.l.........................',
      '.....ohphphpppppppHHdddoool.L...........................',
      '.....odhphphHHHHHdddoooL.l..............................',
      '.....lodhhhhhddddoooll..................................',
      '......lodddddoooo.L.....................................',
      '........oooooL.ll.......................................',
      '........L.ll............................................',
    ],
  },
  4: {   // четырёхместная: рыбацкое судно — рубка с окнами, мачта с тросами, бухты верёвки, ведро и сеть за бортом
    pal: { B: '3f6f92', C: 'e7dcc0', G: 'c0824a', K: '7a4026', L: 'd8f0f8', M: '7a4026', Q: '8f7f63', R: 'dfa468', U: '5b8fb0', V: '8a4a2a', W: 'e8e2d4', Y: '6f7f89', b: '2c5070', k: '3a1810', l: '9fd4e8', m: '4a2117', n: '2c4258', o: '1c0806', p: '62301c', q: 'cbbf9f', r: 'b9763f', u: '3f6f92', v: '74391f', w: 'bdb3a3', y: '9fb0b8' },
    map: [
      '..............................................o.................................',
      '.............................................omo................................',
      '............................................ommMo...............................',
      '............................................omMMoqq.............................',
      '............................................omMMo..qqq..........................',
      '............................................omMMo.....qqq.......................',
      '............................................omMMo........qqq....................',
      '............................................omMMo...........qqq.................',
      '...........................................qomMMo..............qq...............',
      '...........................................qomMMo................qqq............',
      '...........................................qomMMo...................qqq.........',
      '..........................................q.omMMo...................oooooooooo..',
      '..........................................q.omMMo.............oooooobRRRRRqqbRo.',
      '.........................................q..omMMo........ooooobRRRRRRRRRRRRRRqqo',
      '.........................................q..omMMo.....ooobRRRRRRRRRRRkkkkkkkkRro',
      '........................................q...omMMo..oooRRRRRRRRRkkkkkkKKKKKKKKrVo',
      '........................................q...omMMoooRRRRRRRRkkkkKKKKKKKKKKKKKRbvo',
      '........................................q...omMMRRRRRRRkkkkKKKKKKKKKKKKKKKKKRrpo',
      '.......................................q..ooomMMRRRRkkkKKKKKKKKKKKKKKKKKKKKKrVVo',
      '.......................................qoobRRmMMRkkkKKKKKKKKKKKKKKKKKKKKKKKRVvvo',
      '.....................................oooRRRRRmMMkKKKKKKKKKKKKKKKKKKKKKKKKKKRvppo',
      '...................................oobRRRRRRkmMMKKKKKKKKKKKKKKKKKKKKGGGGGKRRpVVo',
      '.................................oobRRRRRkkkKmMMKKKKKKKKKKGGGGGGGGGGGGGGGGrrVvvo',
      '..............................oooRRRRRRkkKKKKmMMKKKKKGGGGGGGGGGGGGGGGGGGGRVVvppo',
      '............................oobRRRRRkqkKKKKKKmMMKGGGGGGGGGGGGqqQGGGGGGGGGrvvpVVo',
      '...........................obRRRRRkkqKKKKKKKKmMMGGGGGGGGGGGGQQQQQQGGGGGGRVppVvvo',
      '.........................ooRRRRRkkKKqKKKKKKGGmMMGGGGGGGGGGGqqqGQQQGGGGGRrvVVvpCo',
      '.......................oobRRRRkkKKKqKKKKKGGGGmMMGGGGGGGGGGGQQQGGqqGGGGGrVpvvpVBo',
      '.....................oobRRRUUUKKKKKqKKGGGGGGGmMMGGGGGGGGGGGQQqqQQqGGGGRVvVppVvBo',
      '....................obRRRUUUUUUKKKKqGGGGGGGGGmMMGGGGGGGGGGGGQqqQQGGGGRrvpvVVvCbo',
      '..................ooRRRUUUUUUUUKKKqGGGGGGGGGGmMMGGGGGGGGGGGGGGGGGGGGRrVpVpvvpBo.',
      '.................obRRUUUUUUUUUUUGGqGGGGGGGGGGmMMGGGGGGGGGGGGGGGGGGGRrVvVvVppCBo.',
      '...............ooRRUUUUUUUUUUUUUUqGGGGGGGGGGGmMMGGGGGGQQqqQQGGGGGGGrVvpvpvVCBbo.',
      '..............obRUUUUUUUUUUUUUUUUqGGGGGGGGGGGmMMGGGGGqQQqQQQQGGGGGRbvpVpVpCBBol.',
      '.............oRUUUUUUUUUUUUUUUUUqUGGGGGGGGGGGmMMGGGGGqqGGGQQQGGGGRrrpVvVvVBBbo..',
      '...........ooUUUUUUUUUUUUUUUUUUUqUUGGGGGGGGGGmMMGGGGGQQGGGGqqGGGRRVVVvpvpCBbol..',
      '..........oUUUUUUUUUUUUUUUUUUUUUUUUUGGGGGGGGGmMMGGGGGQQqqQQqqGGRRQvvvpVpCBbo....',
      '........ooUUUUUUUUUUUUUUUUUUUUUUUUUUUGGGGGGGGmMMGGGGGGqqqQQQGGRqqQpppVvCBBoL....',
      '......ooUUUUUUUUUUUUUUUUUUUUUUUUUUUUUGGGGGGGGGMGGGGGGGGGqqGGGRQQqqVVVvCBBbo.....',
      '.....oUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUGGGYYGGGGGGGGGGGGGGGGRRqqbQQvvvCBBbo......',
      '.....ouUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUYYYYyGGGGGGGGGGGGGGRRQqqqqQppCBBbol......',
      '....obuUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUuYYYYyGGGGGGGGGGGGGrrqQQbQqqVCBBbol.......',
      '..oobRRuUUUUUUUUUUUUUUUUUUUUUUUUUUUUuuuYyyyyGGGGGGGGGGGRRVBqqqqQQQCBBbo.........',
      '.obRRRRKuUUUUUUUUUUUUUUUUUUUUUUUUUuuuGGYyyyyGGGGGGGGGGRrrvbQQqqqqQBBboL.........',
      'oVRRRkkKwuUUUUUUUUUUUUUUUUUUUUUUuuuWWGGGyyyyGGGGGGGGRRrVVpqqQQQQqqBbo...........',
      'ovrRkKKKwuUUUUUUUUUUUUUUUUUUUUuuuWWnnGGGGyyGGGGGGGGrrrVvvVbqqqqQQQbol...........',
      'opVkKKKKwwuUUUUUUUUUUUUUUUUUuuuWWWWnnGGGGGGGGGGGGRrVVVvppvQQQqqqqQol............',
      'oVvVKKKKwwwuUUUUUUUUUUUUUUuuuWWnnWWnnGGGGGGGGGGRrrVvvvpVVpqqQQQQqq..............',
      'ovpvVKKGwwwnuUUUUUUUUUUUUuuWWWnnnWWWWGGGGGGGGRRrVVvpppVvvVbqqqqQQQ..............',
      'opVpvKGGwwwnwuUUUUUUUUUuuWWWWWnnnWWWWGGGGGGRRrrVvvpVVVvpCCQQQqqqqQ..............',
      'oVvVpVGGwwwnnuUUUUUUUuuWWnnWWWnWWWWWWGGGGRrrrVVvppVvvvpCBBqqQQ.Qqq..............',
      'ovpvVvVGGwwwnwuUUUUuuWWWnnnWWWWWWWWGGGGRrrVVVvvpVVvppCCBBBbqqqqQQQ..............',
      'opVpvpvVGGwwnwwuUuuWWWWWnnnWWWWWWGGGRrrrVVvvvppVvvpCCBBBbbQQQqqqqQ..............',
      'oCvVpVpvGGGwwwwwuWWnnWWWnWWWWWWGGGrrrVVVvvpppVVvppCBBBBbooqqQQ.QqL..............',
      'oBpvVvVpVGGGwwwwWWWnnWWWWWWWWGGRrrVVVvvvppVVVvvpCCBBBbbo.lQqqqQQ................',
      'oBVpvpvVvVGGwwwwWWWnnWWWWWWRRrrrVVvvvpppVVvvvpCCBBBbbooL..QQQ.ll................',
      'obCVpVpvpvVGGwwwWWWWWWWWRrrrrVVVvvpppVVVvvppCCBBBBbool....qqQ...................',
      'LoBvVvVpCpvGGGwwWWRrrrrrrVVVVvvvppVVVvvvppCCBBBBbbo.l.....Q.L...................',
      '.oBCvpvVBVprrrrrrrrVVVVVVvvvvpppVVvvvpppCCBBBBbbooL.......l.....................',
      '.obBCVpvBvVVVVVVVVVvvvvvvppppVVVvvpppCCCBBBBbbool...............................',
      '..oBBCVpbpvvvvvvvvvppppppVVVVvvvppVCCBBBBBbboo.l................................',
      '..obBBvVGVpppppppppVVVVVVvvvvpppCCCBBBBBbboo.L..................................',
      '..lobBCvVvVVVVVVVVVvvvvvvppppCCCBBBBBbbbooll....................................',
      '...lobBCvpvvvvvvvvvppppppVCCCBBBBBBbboooL.......................................',
      '.....oBBCVpppppppppVVVVCCCBBBBBBbbbooll.........................................',
      '.....obBBvVVVVVVVVVvCCCBBBBBBbbboooL............................................',
      '.....LobBCvvvvvvCCCCBBBBBBbbboooll..............................................',
      '.......obBCppCCCBBBBBBBbbbooo.L.................................................',
      '.......loBBCCBBBBBBBbbbooo.ll...................................................',
      '........obBBBBBBbbbboool.L......................................................',
      '........lobBBbbbooooL.l.........................................................',
      '..........obbooo.ll.............................................................',
      '..........Lool.L................................................................',
      '............l...................................................................',
    ],
  },
};

const BOB = { period: 3.2, amp: 1 };                 // покачивание: на пиксель вверх и обратно, у каждой лодки своя фаза

// Картинка лодки этого вида (flip — носом вверх-влево). Её же рисует остров (island-view.ts) и экран переправы в движке.
export function paintBoat(kind: BoatKind, flip = false) { return paint(BOAT_ART[kind], flip); }
// Где на карте картинка лодки, стоящей нижним краем посередине в (x, y): по ней кликают, чтобы сесть в лодку.
export function boatBox(kind: BoatKind, x: number, y: number) {
  const a = BOAT_ART[kind], w = a.map[0]!.length, h = a.map.length;
  return { x: Math.round(x - w / 2), y: y - h, w, h };
}

function paint(a: BoatArt, flip: boolean) {
  const w = a.map[0]!.length, h = a.map.length, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!, id = x.createImageData(w, h);
  a.map.forEach((row, j) => { for (let i = 0; i < w; i++) {
    const hex = a.pal[row[i]!]; if (!hex) continue;
    const o = (j * w + (flip ? w - 1 - i : i)) * 4;
    id.data[o] = parseInt(hex.slice(0, 2), 16); id.data[o + 1] = parseInt(hex.slice(2, 4), 16); id.data[o + 2] = parseInt(hex.slice(4, 6), 16); id.data[o + 3] = 255;
  } });
  x.putImageData(id, 0, 0); return c;
}

// W, H — размер карты; water — маска воды из river-view: пиксели лодок из неё вычёркиваются, чтобы дождь не рисовал на них круги
// (блики и тень у борта — l, L, w — остаются водой).
export function createBoatsView(W: number, H: number, water: Uint8Array) {
  const boats = BERTHS.map((b, n) => {
    const a = BOAT_ART[b.kind], img = paint(a, !!b.flip), x = Math.round(b.x - img.width / 2), y = b.y - img.height;
    a.map.forEach((row, j) => { for (let i = 0; i < row.length; i++) {
      const c = row[b.flip ? row.length - 1 - i : i]!, px = x + i, py = y + j;
      if (c !== '.' && c !== 'l' && c !== 'L' && c !== 'w' && px >= 0 && px < W && py >= 0 && py < H) water[py * W + px] = 0;
    } });
    return { img, x, y, foot: b.y, phase: n * 1.7 };
  });
  // Для очереди «кто дальше — тот раньше»: y — днище лодки; t — время в секундах.
  return boats.map(b => ({
    y: b.foot,
    draw(ctx: CanvasRenderingContext2D, t: number) {
      const dy = Math.sin((t / BOB.period + b.phase) * Math.PI * 2) > 0.3 ? -BOB.amp : 0;
      ctx.drawImage(b.img, b.x, b.y + dy);
    },
  }));
}
