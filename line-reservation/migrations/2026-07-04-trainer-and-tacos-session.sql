-- 2026-07-04: 体験パーソナルの担当トレーナー選択 ＋ TACOS Partyの別枠セッション化
-- 既に稼働中の本番D1（line-harness）に対して1回だけ実行する。
-- 新規セットアップの場合はschema.sqlで最初から反映済みなので、このファイルは不要。

ALTER TABLE reservations ADD COLUMN trainer TEXT;

-- 7/19ピラティスからTACOS Partyの紐付けを外す（別枠セッション化のため）
UPDATE sessions SET has_tacos = 0, note = '朝RUN 6:30〜あり' WHERE id = '2026-07-19';

-- TACOS Partyを独立したセッションとして追加（ピラティスとは別枠・単独参加OK）
INSERT OR IGNORE INTO sessions VALUES
  ('2026-07-19-tacos','2026-07-19','7/19（日）午後','TACOS Party（午後の部）',
   NULL,NULL,0,10,1,NULL,
   0,'12:00〜21:00 ／ 参加費（タコス込み）¥3,000 ／ タコス × サウナ × コーヒー × アルコール（ピラティスとは別枠・単独参加OK）');
