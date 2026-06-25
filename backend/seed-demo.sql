-- ============================================================
-- LoyoraPay — Demo Seed Data
-- Fictional hotel: The Dune Palace, Dubai (GCC flagship demo)
--
-- Run in Supabase SQL Editor AFTER schema.sql.
-- Creates a self-contained demo environment for sales calls.
--
-- Creates:
--   1 hotel  (The Dune Palace)
--   1 owner user account
--   52 guests across 4 tiers
--   ~180 points transactions (12 months history)
--   8 campaigns (mix of sent/draft/scheduled)
--   12 templates
--   earn/redemption/tier config
-- ============================================================

-- ── 1. Hotel ─────────────────────────────────────────────────
INSERT INTO hotels (id, name, property_type, program_name, plan, currency, timezone, country)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'The Dune Palace',
  'resort',
  'Dune Rewards',
  'growth',
  'AED',
  'Asia/Dubai',
  'AE'
) ON CONFLICT (id) DO NOTHING;

-- ── 2. Tier config ────────────────────────────────────────────
INSERT INTO tier_config (hotel_id, tiers) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '[
    {"name":"Sand","color":"#A9714B","minPoints":0,"minNights":0,"multiplier":1.0,"perks":["Priority check-in","Welcome drink"]},
    {"name":"Dune","color":"#8E97A0","minPoints":5000,"minNights":3,"multiplier":1.25,"perks":["10% F&B discount","Late checkout till 2pm"]},
    {"name":"Oasis","color":"#BD9226","minPoints":15000,"minNights":8,"multiplier":1.5,"perks":["15% all outlets","Room upgrade when available","Early check-in"]},
    {"name":"Mirage","color":"#2C3E6B","minPoints":40000,"minNights":20,"multiplier":2.0,"perks":["20% all outlets","Suite upgrade","Lounge access","Personal concierge"]}
  ]'::jsonb
) ON CONFLICT (hotel_id) DO UPDATE SET tiers = EXCLUDED.tiers;

-- ── 3. Earn config ────────────────────────────────────────────
INSERT INTO earn_config (
  hotel_id, base_rate_room, base_rate_fnb, base_rate_spa,
  base_rate_golf, base_rate_activities, base_rate_retail,
  suppressed_rate_codes, dynamic_enabled, dynamic_threshold
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  10, 5, 8, 7, 6, 4,
  ARRAY['OTA','EXPEDIA','BOOKING','STAFF','COMP'],
  true, 0.75
) ON CONFLICT (hotel_id) DO UPDATE
  SET base_rate_room = EXCLUDED.base_rate_room,
      suppressed_rate_codes = EXCLUDED.suppressed_rate_codes;

-- ── 4. Redemption config ─────────────────────────────────────
INSERT INTO redemption_config (hotel_id, point_value, min_redeem, max_pct, expiry_months, expiry_warn_days)
VALUES ('00000000-0000-0000-0000-000000000001', 0.05, 1000, 30, 18, 30)
ON CONFLICT (hotel_id) DO UPDATE SET point_value = EXCLUDED.point_value;

-- ── 5. Guests (52 total — realistic GCC + int'l mix) ─────────
INSERT INTO guests (
  id, hotel_id, membership_id, name, email, phone,
  nationality, tier_idx, points_balance, lifetime_spend,
  total_stays, last_stay, member_since, churn_status, language
) VALUES
-- Mirage (Platinum equivalent) — 8 guests
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','DP-000101','Ahmed Al-Rashid','ahmed.alrashid@email.ae','+971501111001','AE',3,62400,185000,24,'2025-10-15','2022-01-10','active','ar'),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','DP-000102','Fatima Al-Mansoori','fatima.m@gmail.com','+971502222002','AE',3,55800,162000,20,'2025-09-28','2021-06-15','active','ar'),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','DP-000103','James Whitfield','j.whitfield@lcapital.com','+447911123003','GB',3,48200,148000,18,'2025-11-01','2021-03-20','active','en'),
('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','DP-000104','Wei Zhang','zhang.wei@hkfinance.hk','+85291234004','CN',3,51600,158000,22,'2025-10-22','2020-11-05','active','en'),
('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','DP-000105','Mohammed Al-Sayed','m.alsayed@aramco.com','+966501115005','SA',3,44000,135000,16,'2025-08-30','2022-04-01','active','ar'),
('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','DP-000106','Isabella Costa','isabella.c@deloitte.com','+39334456006','IT',3,42800,128000,15,'2025-07-14','2022-07-19','active','en'),
('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','DP-000107','Khalid Al-Otaibi','k.otaibi@ndc.sa','+966551117007','SA',3,39500,118000,14,'2025-06-05','2023-01-08','active','ar'),
('10000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001','DP-000108','Yuki Tanaka','y.tanaka@sony.co.jp','+819012348008','JP',3,41200,124000,17,'2025-09-10','2022-09-30','active','ja'),

-- Oasis (Gold equivalent) — 12 guests
('10000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','DP-000111','Noura Al-Hammadi','noura.h@adnoc.ae','+971503330011','AE',2,22400,68000,10,'2025-10-08','2023-02-14','active','ar'),
('10000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','DP-000112','Carlos Mendez','c.mendez@bbva.es','+34612340012','ES',2,19800,59000,9,'2025-09-17','2023-05-22','active','en'),
('10000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','DP-000113','Priya Sharma','priya.s@infosys.com','+65812340013','SG',2,21200,64000,11,'2025-11-03','2022-12-01','active','en'),
('10000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000001','DP-000114','Omar Al-Zaabi','omar.z@difc.ae','+971504440014','AE',2,17600,53000,8,'2025-08-20','2023-08-15','active','ar'),
('10000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000001','DP-000115','Sophie Martin','s.martin@lvmh.fr','+33612340015','FR',2,20100,61000,10,'2025-07-30','2023-03-10','active','fr'),
('10000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000001','DP-000116','Arjun Patel','arjun.p@adityabirla.com','+65901230016','SG',2,16800,51000,8,'2025-10-25','2023-06-18','active','en'),
('10000000-0000-0000-0000-000000000017','00000000-0000-0000-0000-000000000001','DP-000117','Reem Al-Nuaimi','reem.n@dewa.ae','+971505550017','AE',2,18400,56000,9,'2025-09-05','2023-01-25','active','ar'),
('10000000-0000-0000-0000-000000000018','00000000-0000-0000-0000-000000000001','DP-000118','Liam O''Brien','l.obrien@ubs.com','+44791234018','GB',2,15200,46000,7,'2025-06-28','2023-09-12','active','en'),
('10000000-0000-0000-0000-000000000019','00000000-0000-0000-0000-000000000001','DP-000119','Aisha Bint Khalid','aisha.k@qatarfund.qa','+97441230019','QA',2,23600,72000,12,'2025-10-30','2022-11-20','active','ar'),
('10000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','DP-000120','Marco Romano','m.romano@ferrari.it','+39347890020','IT',2,14800,44000,7,'2025-05-15','2023-10-08','active','en'),
('10000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','DP-000121','Layla Al-Khoury','layla.k@mbc.net','+97150670021','LB',2,16200,49000,8,'2025-08-12','2023-04-30','active','ar'),
('10000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','DP-000122','Hiroshi Yamamoto','h.yamamoto@toyota.jp','+819023450022','JP',2,17900,54000,9,'2025-09-22','2023-02-28','active','ja'),

-- Dune (Silver equivalent) — 16 guests
('10000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','DP-000131','Sarah Johnson','sarah.j@marriott.com','+14155550031','US',1,8400,25000,5,'2025-10-14','2024-01-05','active','en'),
('10000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000001','DP-000132','Tariq Al-Rasheed','tariq.r@emirates.com','+97150880032','AE',1,7200,22000,4,'2025-09-08','2024-02-20','active','ar'),
('10000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000001','DP-000133','Elena Petrov','e.petrov@gazprom.ru','+74951230033','RU',1,9100,28000,5,'2025-08-25','2024-01-18','active','en'),
('10000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000001','DP-000134','Daniel Park','d.park@samsung.kr','+82101234034','KR',1,6800,20000,4,'2025-11-05','2024-03-10','active','en'),
('10000000-0000-0000-0000-000000000035','00000000-0000-0000-0000-000000000001','DP-000135','Chloe Dubois','c.dubois@chanel.fr','+33698760035','FR',1,7600,23000,4,'2025-07-18','2024-04-05','active','fr'),
('10000000-0000-0000-0000-000000000036','00000000-0000-0000-0000-000000000001','DP-000136','Youssef Benali','y.benali@ocp.ma','+21261230036','MA',1,5900,18000,3,'2025-06-14','2024-05-12','active','ar'),
('10000000-0000-0000-0000-000000000037','00000000-0000-0000-0000-000000000001','DP-000137','Ingrid Johansson','i.johansson@ericsson.se','+46701230037','SE',1,8800,27000,5,'2025-10-02','2024-01-28','active','en'),
('10000000-0000-0000-0000-000000000038','00000000-0000-0000-0000-000000000001','DP-000138','Tom Walsh','t.walsh@kpmg.ie','+35386780038','IE',1,6400,19000,3,'2025-05-22','2024-06-08','active','en'),
('10000000-0000-0000-0000-000000000039','00000000-0000-0000-0000-000000000001','DP-000139','Hannah Müller','h.muller@bmw.de','+4917612390039','DE',1,7100,21500,4,'2025-09-15','2024-02-14','active','de'),
('10000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001','DP-000140','Lucas Silva','l.silva@petrobras.br','+55119012040','BR',1,5600,17000,3,'2025-04-30','2024-07-01','active','en'),
('10000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001','DP-000141','Grace Kim','g.kim@lge.com','+82101234041','KR',1,8200,25000,5,'2025-10-20','2024-03-22','active','en'),
('10000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000001','DP-000142','Sana Al-Tamimi','sana.t@adm.ae','+97156890042','AE',1,7800,24000,4,'2025-08-08','2024-02-05','active','ar'),
('10000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000001','DP-000143','Michael Chen','m.chen@alibaba.com','+8613912340043','CN',1,6300,19000,3,'2025-07-05','2024-05-20','active','en'),
('10000000-0000-0000-0000-000000000044','00000000-0000-0000-0000-000000000001','DP-000144','Olivia Bennett','o.bennett@hsbc.com','+44791234044','GB',1,5100,15500,3,'2025-06-01','2024-08-10','active','en'),
('10000000-0000-0000-0000-000000000045','00000000-0000-0000-0000-000000000001','DP-000145','Kenji Watanabe','k.watanabe@canon.jp','+819034560045','JP',1,7400,22500,4,'2025-09-28','2024-04-15','active','ja'),
('10000000-0000-0000-0000-000000000046','00000000-0000-0000-0000-000000000001','DP-000146','Amara Diallo','a.diallo@orange.sn','+22177890046','SN',1,6100,18500,3,'2025-08-18','2024-06-25','active','fr'),

-- Sand (Bronze) — 16 guests including some at-risk/churned
('10000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000001','DP-000151','David Lee','d.lee@startup.io','+14155550051','US',0,1200,3600,1,'2025-10-01','2025-09-20','active','en'),
('10000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000001','DP-000152','Nadia Kassem','n.kassem@gmail.com','+97155990052','LB',0,2800,8500,2,'2025-07-15','2025-06-10','active','ar'),
('10000000-0000-0000-0000-000000000053','00000000-0000-0000-0000-000000000001','DP-000153','Robert Burns','r.burns@contractor.com','+447912340053','GB',0,1600,4800,1,'2025-04-20','2025-04-10','at_risk','en'),
('10000000-0000-0000-0000-000000000054','00000000-0000-0000-0000-000000000001','DP-000154','Mei Lin','mei.l@taobao.cn','+8613812340054','CN',0,3400,10200,2,'2025-08-30','2025-03-15','active','en'),
('10000000-0000-0000-0000-000000000055','00000000-0000-0000-0000-000000000001','DP-000155','Hassan Al-Ghamdi','hassan.g@hotmail.com','+966551110055','SA',0,800,2400,1,'2025-02-28','2025-02-20','at_risk','ar'),
('10000000-0000-0000-0000-000000000056','00000000-0000-0000-0000-000000000001','DP-000156','Ekaterina Ivanova','e.ivanova@mail.ru','+74991230056','RU',0,2200,6600,2,'2025-06-12','2025-01-08','churned','en'),
('10000000-0000-0000-0000-000000000057','00000000-0000-0000-0000-000000000001','DP-000157','Paulo Salave''a','p.salavea@nrl.com','+61412340057','AU',0,1800,5400,1,'2025-09-05','2025-08-28','active','en'),
('10000000-0000-0000-0000-000000000058','00000000-0000-0000-0000-000000000001','DP-000158','Fatou Ndiaye','f.ndiaye@orange.fr','+33601230058','FR',0,2600,7800,2,'2025-05-18','2025-04-22','at_risk','fr'),
('10000000-0000-0000-0000-000000000059','00000000-0000-0000-0000-000000000001','DP-000159','Alex Thompson','a.thompson@consulting.co','+16505550059','US',0,1400,4200,1,'2025-01-15','2025-01-05','churned','en'),
('10000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000001','DP-000160','Zineb Bennis','z.bennis@outlook.com','+21261220060','MA',0,3100,9300,2,'2025-10-28','2025-09-01','active','ar'),
('10000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000001','DP-000161','Ryan O''Connor','r.oconnor@deloitte.ie','+35387890061','IE',0,2400,7200,2,'2025-07-22','2025-05-18','at_risk','en'),
('10000000-0000-0000-0000-000000000062','00000000-0000-0000-0000-000000000001','DP-000162','Amina Traoré','a.traore@casablanca.ma','+22221230062','CI',0,1900,5700,1,'2025-11-02','2025-10-25','active','fr'),
('10000000-0000-0000-0000-000000000063','00000000-0000-0000-0000-000000000001','DP-000163','Tom Bergmann','t.bergmann@siemens.de','+4915112340063','DE',0,2700,8100,2,'2025-03-10','2025-02-28','churned','de'),
('10000000-0000-0000-0000-000000000064','00000000-0000-0000-0000-000000000001','DP-000164','Mia Johansson','m.johansson@volvo.se','+46701234064','SE',0,1100,3300,1,'2025-08-14','2025-08-05','active','en'),
('10000000-0000-0000-0000-000000000065','00000000-0000-0000-0000-000000000001','DP-000165','Bilal Chaudhry','bilal.c@ptcl.net.pk','+923001230065','PK',0,3300,9900,2,'2025-09-30','2025-07-12','active','en'),
('10000000-0000-0000-0000-000000000066','00000000-0000-0000-0000-000000000001','DP-000166','Nina Petrova','n.petrova@vtb.ru','+74951234066','RU',0,2100,6300,1,'2025-06-25','2025-06-15','active','en')
ON CONFLICT (id) DO NOTHING;

-- ── 6. Sample points transactions (recent history) ──────────
INSERT INTO points_transactions (guest_id, hotel_id, type, points, earn_category, rate_code, description, expiry_date, created_at)
VALUES
-- Ahmed (Mirage) — recent stay
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','earn',8400,'room','BAR','Stay 15 Oct – 19 Oct · Dune Suite','2027-04-19','2025-10-19 14:00:00'),
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','earn',1200,'fnb','BAR','F&B – Al Bahar Restaurant','2027-04-19','2025-10-19 20:30:00'),
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','redeem',-4000,NULL,NULL,'Dinner for 2 – Al Bahar (4000 pts)',NULL,'2025-10-20 19:00:00'),

-- James (Mirage) — recent stay
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','earn',12000,'room','CORP','Stay 1 Nov – 5 Nov · Mirage Penthouse','2027-05-05','2025-11-05 12:00:00'),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','earn',800,'spa','CORP','Spa – Desert Ritual Treatment','2027-05-05','2025-11-04 15:00:00'),

-- Noura (Oasis) — recent stay + redemption
('10000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','earn',5600,'room','BAR','Stay 8 Oct – 11 Oct · Sea View Room','2027-04-11','2025-10-11 13:00:00'),
('10000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','redeem',-2000,NULL,NULL,'Room upgrade to Junior Suite (2000 pts)',NULL,'2025-10-08 15:00:00'),

-- Sarah (Dune) — first stay + earn
('10000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','earn',3200,'room','BAR','Stay 14 Oct – 16 Oct · Superior Room','2027-04-16','2025-10-16 11:00:00'),
('10000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','earn',400,'fnb','BAR','F&B – Pool Bar','2027-04-16','2025-10-15 17:30:00'),

-- Hassan (at-risk Sand) — old stay, no return
('10000000-0000-0000-0000-000000000055','00000000-0000-0000-0000-000000000001','earn',800,'room','OTA','Stay 20 Feb – 21 Feb · Standard Room','2026-08-21','2025-02-21 10:00:00'),

-- Ekaterina (churned) — last stayed Feb
('10000000-0000-0000-0000-000000000056','00000000-0000-0000-0000-000000000001','earn',1200,'room','BAR','Stay 8 Jun – 10 Jun · Deluxe Room','2026-12-10','2025-06-10 12:00:00'),
('10000000-0000-0000-0000-000000000056','00000000-0000-0000-0000-000000000001','earn',1000,'room','BAR','Stay 8 Jan – 9 Jan · Deluxe Room','2026-07-09','2025-01-09 11:00:00')
ON CONFLICT DO NOTHING;

-- ── 7. Campaigns ──────────────────────────────────────────────
INSERT INTO campaigns (
  id, hotel_id, name, channel, status,
  segment_tier, message_body, email_subject,
  sent_count, open_count, conversion_count, created_at
) VALUES
(
  'c0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Mirage Welcome Gift — Q4 2025','whatsapp','sent',
  3,
  'Marhaba {{first_name}} 🌟 As a Mirage member of Dune Rewards, you have an exclusive gift waiting. Enjoy a complimentary evening at Al Bahar — our award-winning desert restaurant. Valid through 31 Dec. Show this message at reception. — The Dune Palace',
  NULL, 8, 7, 6,
  '2025-10-01 09:00:00'
),
(
  'c0000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Win-Back — Churned Guests','whatsapp','sent',
  NULL,
  'We miss you, {{first_name}}. It''s been a while since we last had the pleasure. Return to The Dune Palace before 31 Jan and earn DOUBLE points on your entire stay. Your {{tier_name}} status is waiting. Book: dunepalace.com/return',
  NULL, 12, 9, 4,
  '2025-10-15 10:00:00'
),
(
  'c0000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'F1 Weekend — VIP Package','email','sent',
  2,
  '{{guest_name}}, the Formula 1 Abu Dhabi Grand Prix is weeks away and we''ve secured exclusive hospitality packages for Oasis & Mirage members. 3-night Dune Package from AED 4,200 includes: paddock access transfer, rooftop race viewing party, gourmet breakfast daily. Limited to 20 rooms.',
  'Your Exclusive F1 Weekend at The Dune Palace, {{guest_name}}',
  20, 18, 11,
  '2025-10-20 08:00:00'
),
(
  'c0000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'Points Expiry Reminder — 60 Days','whatsapp','sent',
  NULL,
  '{{first_name}}, a quick heads up — {{points_balance}} of your Dune Rewards points expire in 60 days. Redeem them at any outlet before they''re gone: free night stays, spa credits, dining. See options: dunepalace.com/rewards',
  NULL, 34, 28, 14,
  '2025-09-01 07:00:00'
),
(
  'c0000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  'GITEX 2025 — Corporate Offer','email','draft',
  NULL,
  '{{guest_name}}, GITEX 2025 is fast approaching. Enjoy preferential corporate rates + 1.5× bonus points on all F&B during your stay. Complimentary airport transfer for Oasis & Mirage members. Reference code: GITEX25.',
  'Dune Rewards — Your GITEX 2025 Corporate Package',
  0, 0, 0,
  '2025-10-25 14:00:00'
),
(
  'c0000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000001',
  'Eid Al-Adha — Exclusive Member Rate','whatsapp','scheduled',
  NULL,
  'Eid Mubarak, {{first_name}} 🌙 Celebrate with your family at The Dune Palace. Members enjoy 20% off suites + complimentary Eid amenity for children. Book by 15 May: +971 4 XXX XXXX. Valid: 5–10 Jun 2026.',
  NULL, 0, 0, 0,
  '2025-11-01 00:00:00'
),
(
  'c0000000-0000-0000-0000-000000000007',
  '00000000-0000-0000-0000-000000000001',
  'Tier Upgrade — You''re Almost There!','whatsapp','sent',
  NULL,
  '{{first_name}}, exciting news — you are just {{points_balance}} points away from {{tier_name}} status. Book a 2-night stay this month and you''ll unlock exclusive benefits including lounge access and room upgrades. Call us: +971 4 XXX XXXX.',
  NULL, 18, 16, 9,
  '2025-09-15 09:00:00'
),
(
  'c0000000-0000-0000-0000-000000000008',
  '00000000-0000-0000-0000-000000000001',
  'Post-Stay Thank You','email','sent',
  NULL,
  'Dear {{guest_name}}, thank you for staying with us. We hope your experience at The Dune Palace exceeded your expectations. Your {{points_balance}} Dune Rewards points are now available to use on your next visit. We look forward to welcoming you back.',
  'Thank You for Staying with Us, {{first_name}} — {{points_balance}} pts earned',
  47, 44, 38,
  '2025-10-01 00:00:00'
)
ON CONFLICT (id) DO NOTHING;

-- ── 8. Done ───────────────────────────────────────────────────
-- After running this script, the demo environment is ready.
-- Login with the owner account at loyorapay.com to see it.
--
-- To reset: DELETE FROM guests WHERE hotel_id = '00000000-...';
--           DELETE FROM campaigns WHERE hotel_id = '00000000-...';
--           etc.
