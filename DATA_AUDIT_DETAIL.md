# Dirty Data — Per-Record Detail Report

Generated: 2026-05-31
Source: live Supabase service-role scan.

> Use this file for manual cleanup. Every section lists the **id**,
> **created_at**, **created_by**, **company**, **batch type**, **customer name**,
> **customer phone**, the **dirty value**, and the **proposed fix**.

---

## Summary counts

| Bucket | Count | Recommended action |
|---|---|---|
| **State orphans** (transfers — `Tu`, `St`, `Nw`, `Ae`, `Za`) | 5 | SET State = NULL |
| **Phone — transfers** (wrong length / has letters / extra chars) | 13 | Manual review per row |
| **Phone — callbacks** | 10 | Manual review per row |
| **Names with digits — transfers** | 4 | Manual: strip digits OR null |
| **Names with digits — callbacks** | 13 | Manual: strip digits OR null |
| **ZIP — fixable by padding 4-digit → 5-digit with leading 0** | 214 | Auto-pad (SQL below) |
| **ZIP — junk (`-`, state codes, blank)** | 408 | SET zip = NULL |
| **Email — transfers (missing `@`)** | 110 | SET email = `no@email.com` |
| **Email — sales (missing `@`)** | 128 | SET email = `no@email.com` |
| **VIN — sales (not 17 chars)** | 2 | Manual lookup or null |

---

## 1. State orphans — 5 rows (transfers.form_data.State)

These 5 values look like USPS codes but are not real. Migration 067 cleaner left them untouched because length is 2 chars (not flagged as junk) and they did not match any state.

| id | created_at | created_by | company | batch | customer | phone | BAD value | proposed fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| b38138d1-3ad2-41a9-9e64-d5c34e77a3ad | 2026-05-06 23:45 | Malahim Babar | Wavetech Infomatics | BULK | Barry Sonnenfeld | 9186073620 | Tu | NULL |
| aaec0cd7-42d7-4c00-a02a-645bcf4243cb | 2026-05-08 17:43 | Ameer Hamza | Wavetech Infomatics | BULK | Fred Stoufer | 7074813958 | St | NULL |
| 4d7de93d-b7f2-4158-8397-98a03e5970f8 | 2026-05-06 04:00 | Daud Rehman | Wavetech Infomatics | BULK | Donald Fitzgerald | 8646178834 | Nw | NULL |
| 6b5cb3e2-1586-453c-9dff-6a643f473a8f | 2026-05-04 18:18 | M. Mohsin | EasyTech Communications | MANUAL | Harold Brownjr | 8433776725 | Ae | NULL |
| 2aba5e81-baa5-46f2-b652-81ad41de15d2 | 2026-05-04 18:40 | Farrukh Saleem | Wavetech Infomatics | BULK | Richard L Justi | 6123632540 | Za | NULL |

---

## 2. Phone issues — transfers (13 rows)

Wrong digit count, has letters, or has extra noise. Decide per row whether to keep stripped digits, null it, or recover from another source.

| id | created_at | created_by | company | batch | customer | BAD phone | digit count | suggestion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 68cd7885-d2cd-4396-91d0-b937f0fc8f6c | 2026-05-23 22:44 | Junaid Umer Daraz | Wavetech Infomatics | MANUAL | Erick Aguilar | 8474455874 801 | 13 | NULL |
| a1833091-a88d-461b-8f02-3f44cd8de08a | 2026-05-06 20:47 | Malahim Babar | Wavetech Infomatics | BULK | Chris Mauro | 302287209 | 9 | NULL |
| 0663c695-bc1b-4ace-ba01-3ba43c03c2e1 | 2026-05-09 04:00 | Maham Zahra | The Mejor Communications | BULK | Monica Thomas | 913306007 | 9 | NULL |
| c9c71221-a093-4fe8-b30a-ad2cd33e7660 | 2026-05-21 18:48 | Nishat Nasir | The Mejor Communications | MANUAL | Queen Estate | 09174806115 | 11 | NULL |
| ca0e84ac-d257-45f7-9563-aaf1edf75b57 | 2026-05-11 04:00 | Maham Zahra | The Mejor Communications | BULK | Teddy Maynard | 352217182 | 9 | NULL |
| fc23e46f-c746-4aaa-b92e-ecf9ac1c25ac | 2026-05-30 18:30 | Ammara Rasool | The Mejor Communications | MANUAL | Harry Frye | 23707 | 5 | NULL |
| 4d4a6d5f-37b6-425b-b95b-a6f8f3ca3b70 | 2026-05-30 18:31 | Ammara Rasool | The Mejor Communications | MANUAL | Anthony Dean | ROGUE | 0 | NULL |
| a0471bdf-debf-45df-b167-c32f9775622c | 2026-05-30 21:13 | Nishat Nasir | The Mejor Communications | MANUAL | Michell Brewer | 02197768649 | 11 | NULL |
| 0372c6fb-9c1f-450b-a04a-c6dcc1e2f1c6 | 2026-05-22 18:57 | Huzaifa Kaleem | The Mejor Communications | MANUAL | Jaryvic Luna | LUNA | 0 | NULL |
| 3e9f9359-edd6-4e7c-a907-d7b285e52fce | 2026-05-15 23:46 | Waleed Amjad | The Mejor Communications | MANUAL | Shirley Williams | 301775762 | 9 | NULL |
| a672a845-4665-47da-8262-39cbb5121d16 | 2026-05-16 16:48 | Waleed Amjad | The Mejor Communications | MANUAL | Keith Duranczyk | 100 000 miles | 6 | NULL |
| 4d5a7916-048f-4b2f-9d5c-9a19d043a546 | 2026-05-21 16:07 | Waleed Amjad | The Mejor Communications | MANUAL | Veryl Geltz | 65 284 miles | 5 | NULL |
| acf58664-9922-4356-a6f1-b584eb6fb470 | 2026-05-19 21:04 | Haider Waqas Khan | EasyTech Communications | MANUAL | Christina Freeman | MACEACHERN | 0 | NULL |

---

## 3. Phone issues — callbacks (10 rows)

| id | created_at | created_by | customer | BAD phone | digit count | suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| cfeefaed-94ea-4370-9df9-d7899dd0a5af | 2026-05-06 23:52 | Haider Waqas Khan | Leatha Scott | 1 9184068472 | 11 | 9184068472 |
| 67c2bd82-4faa-46e5-8838-1786a646b67e | 2026-04-28 15:07 | M. Mohsin | 9032799564 | DEBRA BRYAN | 0 | NULL |
| 5170ea01-1ce6-4bb0-8b14-22a2769b2775 | 2026-05-02 21:13 | M. Mohsin | 8326305986 | QUALON WATSON | 0 | NULL |
| ff943a63-e574-4949-850a-6b0cad6fb9f0 | 2026-05-06 16:04 | Haider Waqas Khan | Alok Shankar | 1 6892545111 | 11 | 6892545111 |
| 9cac90cc-578c-4cca-ae9c-6a8eaf83a60f | 2026-05-05 17:59 | Haider Waqas Khan | Otha Wright | 1 4787187562 | 11 | 4787187562 |
| f21d7625-9aa0-43ef-b8fe-0c5f142486c1 | 2026-05-07 22:53 | Ahsan Ali | 7602197177 | JULIE | 0 | NULL |
| a46344ac-3d37-4e89-9e17-a827616ca18d | 2026-05-29 17:27 | Muhammad Umar Mahmood | Tim Drye | FORD  F250 SUPER DUTY 2011  7044001466 | 17 | NULL |
| 88b7a417-91e6-435b-bd58-98a543be3cef | 2026-05-29 18:34 | Rana Muhammad Bilal | Amanda | 63623317188 | 11 | NULL |
| 66e5c450-e035-4bc9-a37b-2421f7b98e39 | 2026-05-18 15:53 | Haider Waqas Khan | Francisco Aceves | 1 8325421229 | 11 | 8325421229 |
| 06ac249a-c0c5-470a-b359-35aefce472f9 | 2026-05-22 22:23 | Fiza Aslam | Nmnm | 6789 | 4 | NULL |

---

## 4. Names with digits — transfers (4 rows)

| id | created_at | created_by | company | batch | BAD name | phone | suggestion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dcd22095-cea5-40d8-8e8b-2ea970ab9e4d | 2026-05-14 18:10 | Abdul Haseeb Malik | The Mejor Communications | MANUAL | 7864991575 Philamar | 7864991575 | Philamar |
| 8678231f-5597-4d45-ad49-6d4446b7a0a7 | 2026-05-20 16:34 | M. Abu Zar | Wavetech Infomatics | MANUAL | Anthony Johnsonshotcallaz1@yahoo.com | 4047482280 | Anthony Johnsonshotcallaz@yahoo.com |
| ccf4d007-2c92-4741-b90e-26a8491dc12f | 2026-05-21 21:36 | M. Faraz Jamil | Wavetech Infomatics | MANUAL | 5163134133  Rush | 5163134133 | Rush |
| 3491eea0-d201-47d8-b492-95929bf6c587 | 2026-05-09 04:00 | Waleed Amjad | The Mejor Communications | BULK | 149 Miles | 9164775923 | Miles |

---

## 5. Names with digits — callbacks (13 rows)

| id | created_at | created_by | BAD customer | phone | suggestion |
| --- | --- | --- | --- | --- | --- |
| 67c2bd82-4faa-46e5-8838-1786a646b67e | 2026-04-28 15:07 | M. Mohsin | 9032799564 | DEBRA BRYAN | NULL |
| 5170ea01-1ce6-4bb0-8b14-22a2769b2775 | 2026-05-02 21:13 | M. Mohsin | 8326305986 | QUALON WATSON | NULL |
| 7aff6427-04d8-49da-91c8-8107bb39f612 | 2026-05-07 17:53 | Ameer Hamza | 2489744968 |  | NULL |
| 08752d03-7167-46c0-8eae-4a945cb40b33 | 2026-05-06 19:01 | Tahrim Fatima | 8564042308 | 8564042308 | NULL |
| d355048d-40bc-4189-a42f-8d202df5a219 | 2026-05-14 21:36 | Syed Faizan Rasool | 4436210511 | 4436210511 | NULL |
| f21d7625-9aa0-43ef-b8fe-0c5f142486c1 | 2026-05-07 22:53 | Ahsan Ali | 7602197177 | JULIE | NULL |
| 9cdd2a8a-8028-424f-b06b-0642107cd6c4 | 2026-05-20 18:15 | Muhammad Jazim Ali | 6159690420 | 6159690420 | NULL |
| a3d5fdfa-552c-4c7e-acbd-9e36e14c7deb | 2026-05-23 18:22 | Junaid Umer Daraz | Lee 7739533845 | 7739533845 | Lee |
| fd5899ac-5eb7-47fa-a4b1-cfafd9304d6b | 2026-05-20 18:15 | Muhammad Jazim Ali | 6098024361 |  | NULL |
| e14e110a-8674-4f20-833e-64b48c33ae26 | 2026-05-23 23:13 | Hafiz Syed Hassan Trimzi | 2026 Gmc Yukon Xl | 9156306235 | Gmc Yukon Xl |
| 0bf7e657-831d-4842-8e55-2ac23dab7c27 | 2026-05-23 23:13 | Hafiz Syed Hassan Trimzi | 2020 Kia Forte | 4783900134 | Kia Forte |
| 6052025e-4c70-4e9f-9714-fda0c3295585 | 2026-05-23 20:52 | Syed Haider Abbas | 46112 |  | NULL |
| 57d01a8d-b98c-4614-a498-35c8fad2c3b0 | 2026-05-29 21:07 | Hafiz Syed Hassan Trimzi | 2022 Hyundai Santa Fe | 7278086655 | Hyundai Santa Fe |

---

## 6. VIN issues — sales (2 rows)

| sale_id | sale_date | closer | batch | reference | customer | phone | BAD vin | length | suggestion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d28099be-f151-4f52-997e-0e65aec9fada | 2026-05-27 21:52 | Zarar Ahmed | BULK | MBH43U8W95 | Cheri Corr-millman | 3022709338 | 2FMPK3J96GBB7116 | 16 | verify (missing 1 char — likely typo) |
| b42dbfef-8db8-49b4-8162-2c3f2136da5c | 2026-05-27 21:51 | Zarar Ahmed | BULK | MBH43GYD61 | Christine Barisciano | 9734762288 | 1N4BL4DW4PN3555679 | 18 | 1N4BL4DW4PN355567 — drop last char if accidental |

---

## 7. ZIP — fixable by leading-zero padding (214 rows)

These all became <5 digits because Excel auto-stripped leading zeros. Safe to pad with `0` prefix until length is 5.

| id | created_at | created_by | company | batch | customer | phone | BAD zip | proposed fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0b352fe0-ddec-4d89-bf3d-bd98a7007b51 | 2026-05-04 23:52 | Sabir Ali Azan | Wavetech Infomatics | BULK | Ferdinand Bardowell | 9178702015 | 6484 | 06484 |
| 89e586da-522c-421e-9878-cbb784f5a8ae | 2026-05-05 16:53 | Salman Amjad | Wavetech Infomatics | BULK | Geiner Mora | 3012049136 | 7922 | 07922 |
| dfd44d1c-bd85-4fd7-b134-7375c84794b3 | 2026-05-05 17:47 | Mubeen Jabbar | Wavetech Infomatics | BULK | Candace Huseman | 8026244183 | 5855 | 05855 |
| 9ceae7ae-4d30-47ea-a3e5-fe3e3477e6e9 | 2026-05-05 21:12 | John Abraham | Wavetech Infomatics | BULK | Alexander Fraser | 8603020884 | 6010 | 06010 |
| 4270232e-d58a-41c1-846a-d8862bc431ac | 2026-05-05 21:49 | Waleed Ali | Wavetech Infomatics | BULK | Deniese Grant | 3475985977 | 6112 | 06112 |
| 8954675e-ed8b-4f42-ad51-d181c6bce62a | 2026-05-05 21:53 | John Abraham | Wavetech Infomatics | BULK | Aspen Terry | 8608333157 | 6074 | 06074 |
| c725676b-8e33-41fd-82c0-8fad92ce574f | 2026-05-05 23:05 | Malahim Babar | Wavetech Infomatics | BULK | Christopher Matsinger | 4016012083 | 2826 | 02826 |
| 8adcc91b-1a87-4a23-80ff-288bff634da1 | 2026-05-06 21:24 | M Rizwan | Wavetech Infomatics | BULK | Frank Muldowney | 8564242457 | 8043 | 08043 |
| 1e082a10-ced0-4ddb-8245-a9012f84cc51 | 2026-05-29 23:12 | Fazal E Hayyee Khan Tayyab | The Mejor Communications | MANUAL | Jamar Taylor | 8593192450 | 4422 | 04422 |
| f9ae94f0-2549-494b-9a44-43e2487e47d1 | 2026-05-07 20:04 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Patricia-a.------------------- Hoffman----------------------- | 8568251696 | 8332 | 08332 |
| cbc2c75d-3c8f-41c1-b1cc-a5503e0bc9e9 | 2026-05-06 22:47 | Muhammad Ahmad | Wavetech Infomatics | BULK | Wayne------------------------- Franklin---------------------- | 7813804802 | 2184 | 02184 |
| 5752828c-0b51-4a70-818e-ce19a1a08ab4 | 2026-05-06 23:20 | Ameer Hamza | Wavetech Infomatics | BULK | James Pitts | 5082853298 | 2766 | 02766 |
| e8d5c848-5823-4758-8bf2-ee166065aa9c | 2026-05-07 15:20 | Ameer Hamza | Wavetech Infomatics | BULK | Alyssa Alvarado | 8603229326 | 6716 | 06716 |
| 2aa0f220-2655-445f-97ed-8ba7198394c1 | 2026-05-07 16:14 | Rehan Shah | Wavetech Infomatics | BULK | Robert Townsend | 5088968911 | 2631 | 02631 |
| e8dccefb-d298-4a53-ae54-6dd24c9efc17 | 2026-05-07 17:22 | Daud Rehman | Wavetech Infomatics | BULK | Thomas Merola | 7326828837 | 7735 | 07735 |
| da571164-77e4-4c9d-af0f-e29dacca5b06 | 2026-05-08 16:29 | M. Abu Zar | Wavetech Infomatics | BULK | Heidi Champagne | 5084770562 | 2649 | 02649 |
| b1cf7112-7279-488b-aa3f-6bc36dfaaec4 | 2026-05-05 04:00 | Onyx | Onyx | BULK | Christine Barisciano | 9734762288 | 7981 | 07981 |
| 65fff88e-92a7-43b9-9042-1249077b25ef | 2026-05-25 19:09 | M Rizwan | Wavetech Infomatics | MANUAL | Katherine Moore | 6033433123 | 3820 | 03820 |
| 0001cebd-9150-4500-8547-8cd383045e54 | 2026-05-09 04:00 | Adil Team | Adil Team | BULK | Levota Forrest | 8563453723 | 8104 | 08104 |
| 80e6eac0-0ec0-4aa9-81e0-14220a372f2b | 2026-05-12 04:00 | M Noman | Wavetech Infomatics | BULK | Alan Hawryluk | 5085271278 | 1970 | 01970 |
| acaf5a50-deea-471e-956c-1ad428d091e2 | 2026-05-21 04:00 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Shirley Mcknight | 2035276723 | 6704 | 06704 |
| 8f599a0a-ae0c-40b1-9e8b-0185eb64d995 | 2026-05-22 04:00 | Huzaifa Shafiq | EasyTech Communications | BULK | Gary Grantham | 8562758957 | 8069 | 08069 |
| afa9d7f3-17ac-45e0-8a7b-9e3f70c0fc61 | 2026-05-12 18:19 | Fiza Aslam | Wavetech Infomatics | BULK | Janice Rock | 6098837361 | 8638 | 08638 |
| 78db9201-f1c7-4468-bf48-da8f0176d740 | 2026-05-25 19:44 | Fatima Wajid | Wavetech Infomatics | MANUAL | Francis Foley | 6037903226 | 3782 | 03782 |
| 6b5cb3e2-1586-453c-9dff-6a643f473a8f | 2026-05-04 18:18 | M. Mohsin | EasyTech Communications | MANUAL | Harold Brownjr | 8433776725 | 9456 | 09456 |
| 924a9045-7b36-4ba4-b370-8d1599855f48 | 2026-05-25 19:44 | M. Abu Zar | Wavetech Infomatics | MANUAL | Yolanda Flores | 9738193395 | 8832 | 08832 |
| 8c4e152d-4835-4d6f-af57-ccfedf5450cf | 2026-05-12 15:24 | Farrukh Saleem | Wavetech Infomatics | BULK | Bob Maloney | 6039682317 | 3245 | 03245 |
| 8f4ecbcc-77af-47cd-a1ae-3b6a4c7e899c | 2026-05-06 23:26 | M. Abu Zar | Wavetech Infomatics | BULK | Yolanda Flores | 9738193395 | 8832 | 08832 |
| 54f14828-3845-44db-af54-c52757c9a90d | 2026-05-11 04:00 | Onyx | Onyx | BULK | Susan Olenick | 8603333934 | 6385 | 06385 |
| cebf5e22-afb7-4880-b3ee-fa1b5c271f4e | 2026-05-06 17:35 | Laiba Khan | Wavetech Infomatics | BULK | Barbara Startup | 8603313672 | 6040 | 06040 |
| 80d2d97f-48be-4f70-a189-5176caec826e | 2026-05-06 17:52 | Touseef Ahmad | Wavetech Infomatics | BULK | Fazlur Chowdhury | 9296917484 | 7502 | 07502 |
| a5234e5f-8e20-4103-bf5e-ce6d6a8e3fa8 | 2026-05-06 17:59 | Danish Waris | Wavetech Infomatics | BULK | Lee Farnham | 6095801960 | 8540 | 08540 |
| 4fa81feb-b146-4934-9f46-1f344cce0516 | 2026-05-01 15:57 | Mubeen Jabbar | Wavetech Infomatics | BULK | Edward Rementer | 6095227468 | 8260 | 08260 |
| e2cd4a9b-2e7d-474c-9026-2714a4d7eeac | 2026-05-01 21:58 | M Mohsin | Wavetech Infomatics | BULK | Mary Bessette | 6037536535 | 3303 | 03303 |
| 2a136895-4477-4430-83da-4e5f8031f32b | 2026-05-01 22:00 | Tahrim Fatima | Wavetech Infomatics | BULK | Dina Mink | 6032570333 | 3275 | 03275 |
| 042b9a58-7f72-410c-9d74-cc308361e45c | 2026-05-01 22:55 | M. Faraz Jamil | Wavetech Infomatics | BULK | Robert Neiman | 9174149270 | 6905 | 06905 |
| 9640a070-703f-455c-a5f3-d7745f7092c8 | 2026-05-05 22:20 | Ali Imran | EasyTech Communications | BULK | Thomas Faleska | 3023543172 | 7719 | 07719 |
| b8c2e7bf-7015-4e3a-9f94-ac39f5ab8064 | 2026-05-02 16:22 | Zaib Un Nisa | Wavetech Infomatics | BULK | Heneesha Webb | 4753199022 | 6770 | 06770 |
| df8a7a80-e18f-473a-a490-d1f8bb76e9a7 | 2026-05-06 16:52 | M Rizwan | Wavetech Infomatics | BULK | Vincent Grieco | 9737906348 | 7512 | 07512 |
| 1db990fc-9293-4f7d-86ba-359969123e8c | 2026-05-14 23:26 | Zaib Un Nisa | Wavetech Infomatics | MANUAL | Luther Jackson | 6179091792 | 2151 | 02151 |
| 3a431ecf-fd7f-43ec-b936-3bce1ac3fe83 | 2026-05-14 23:30 | Zaib Un Nisa | Wavetech Infomatics | MANUAL | Tom Gregory | 2023639696 | N20016 | 20016 |
| 79291a2e-d855-4b5a-940c-acdee1807432 | 2026-05-06 21:03 | M. Iman Suleman | EasyTech Communications | BULK | Viola Danko | 9786602562 | 1453 | 01453 |
| ec094554-587d-412b-ba87-968a9cd83c3f | 2026-05-07 17:07 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Richard Weiner | 6175439860 | 1701 | 01701 |
| 56abda58-33be-46d8-bfe8-2a9d060ff628 | 2026-05-02 20:30 | M. Haris Zahid | Wavetech Infomatics | BULK | Brendan Brendan | 7815074446 | 2180 | 02180 |
| e37d12a7-b264-48f7-85e8-78a62f52ae0a | 2026-05-04 15:15 | M Noman | Wavetech Infomatics | BULK | Donald Roopan | 2035922397 | 6704 | 06704 |
| 165dc1cb-78cf-46be-a5df-b65a9410a897 | 2026-05-04 16:04 | Kashif Saleem | Wavetech Infomatics | BULK | Brian Conant | 2075159040 | 4281 | 04281 |
| e3d22055-ad00-4f87-a642-d34dd44492b1 | 2026-05-04 17:07 | Fiza Aslam | Wavetech Infomatics | BULK | Jason Matos | 9734451625 | 7105 | 07105 |
| 4bd058a3-0039-4dee-9720-10d321428a72 | 2026-05-01 04:00 | Muhammad Ahmad Amir | The Mejor Communications | BULK | Martha Dean | 8486670465 | 7712 | 07712 |
| f541fab1-b6bf-41c4-884a-9b5f4e6c9fbd | 2026-05-05 21:26 | Al Riyyan Shahmir | EasyTech Communications | BULK | Sergey Klepikov | 6175710512 | 2464 | 02464 |
| e1015b50-3170-4dec-b188-26e0e75cc47b | 2026-05-06 18:41 | Zaib Un Nisa | Wavetech Infomatics | BULK | Santiago Morales | 8607486767 | 6084 | 06084 |
| 78e0856f-152f-430e-91c1-fb45e2ae1da3 | 2026-05-02 04:00 | Huzaifa Kaleem | The Mejor Communications | BULK | Rokim Wilson | 4753416740 | 6702 | 06702 |
| 5931fd9f-30ed-4e8d-a9e4-8681faae8e46 | 2026-05-08 22:55 | Sidra Shahbaz | Wavetech Infomatics | BULK | Bill Weiss | 9736257786 | 7834 | 07834 |
| 11b52329-178a-458a-980c-85f9eb613890 | 2026-05-05 04:00 | Ahsan Ali | The Mejor Communications | BULK | Lillie Simmons | 2013622048 | 7666 | 07666 |
| 9680299d-ca53-4897-8179-c0173c707260 | 2026-05-01 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Cheryl Hudson | 2103837821 | 78201TX | 78201 |
| af40b868-1a04-4340-a9c3-024158653f52 | 2026-05-08 23:03 | Hafiz Farhan Sadaqa | Wavetech Infomatics | BULK | Anthony Howard | 9736680733 | 7111 | 07111 |
| f95cd42a-767a-4645-9dea-166152c38312 | 2026-05-01 04:00 | Maham Zahra | The Mejor Communications | BULK | Michael Orellana | 9086442496 | 7663 | 07663 |
| e1703420-62da-41f3-8917-eb50a8cee8b1 | 2026-05-01 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Sue Chan | 3347405498 | 36526 AL | 36526 |
| a4ab7476-628b-431e-b1cd-6420688e8f22 | 2026-05-01 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Willie Valyan | 8325169503 | TX 77045 | 77045 |
| b4070557-feb9-4630-b9bf-77820da500e8 | 2026-05-08 23:58 | Waleed Ali | Wavetech Infomatics | BULK | Marc Estriplet | 9083584508 | 7076 | 07076 |
| 478c8dc4-2870-48b7-adaa-a00f1ed82281 | 2026-05-01 04:00 | Waleed Amjad | The Mejor Communications | BULK | Karen Wilkerson | 8566886216 | 8021 | 08021 |
| 36d540ed-c47c-4162-bc26-7de9d18aedbb | 2026-05-01 04:00 | Muhammad Taha Basit | The Mejor Communications | BULK | Thomas Grant | 6034382130 | 3051 | 03051 |
| 4a574ac3-eb60-4eca-b8b1-f882e0cd6680 | 2026-05-09 17:43 | Rehan Shah | Wavetech Infomatics | BULK | David M. Cook | 2075130149 | 4240 | 04240 |
| a812b8f5-6132-4e89-9404-e20ac0d525c5 | 2026-05-05 22:16 | M. Iman Suleman | EasyTech Communications | BULK | Trevor Furrer | 2018355701 | 7605 | 07605 |
| 24d58348-bf92-4e73-98f4-ed7520bb2a45 | 2026-05-02 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Brunson Abc | 8433449717 | 29440 SC | 29440 |
| db4bb031-1514-47e3-a19c-3cee9c48924f | 2026-05-02 04:00 | Taimoor Ahmad | The Mejor Communications | BULK | Janet Abc | 2032195568 | 6909 | 06909 |
| cb8759e2-05a0-4e84-9cbf-2730b08c3e97 | 2026-05-02 04:00 | Taimoor Ahmad | The Mejor Communications | BULK | Dennis Abc | 9737146001 | 7866 | 07866 |
| d1a99bf2-752e-4050-a4f7-14966d7b0b29 | 2026-05-01 18:32 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Tom Dzicek | 8608411947 | 6029 | 06029 |
| c862a0fc-e852-4b54-9ee3-056534a58c87 | 2026-05-04 04:00 | Huzaifa Kaleem | The Mejor Communications | BULK | Joseph Dilaurentis | 2038377171 | 6811 | 06811 |
| c68d4116-c861-4de4-b42b-06f8c83ed516 | 2026-05-01 18:47 | Laiba Khan | Wavetech Infomatics | BULK | Jeff Fuhrmann | 4138411877 | 1201 | 01201 |
| 3165431e-b67f-4beb-9dcc-57707de63293 | 2026-05-01 20:44 | Fiza Aslam | Wavetech Infomatics | BULK | Isaiah Thomas | 8609841421 | 6053 | 06053 |
| 8dc9c58a-8b24-4330-9b78-ddef3542008a | 2026-05-11 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Lottie Browne | 5417200331 | 50701 IOWA | 50701 |
| 12042ec3-fef1-40f4-b32b-c8513c6b3ace | 2026-05-11 17:48 | Muhammad Ahmad | Wavetech Infomatics | BULK | Donna Horne | 2038460881 | 6851 | 06851 |
| 41091105-22a8-4d65-87a2-c92a028a26e2 | 2026-05-22 20:17 | Muhammad Taha Basit | The Mejor Communications | MANUAL | Ali Diab | 7734129576 | 6045 | 06045 |
| 27e81aa9-194e-44e1-adef-4590c9d710ee | 2026-05-12 18:41 | Zaib Un Nisa | Wavetech Infomatics | BULK | Norbert Knapp | 7328998059 | 8742 | 08742 |
| 684bcac0-13f7-4fe4-91ae-120503d8e7bc | 2026-05-04 04:00 | Ali Haider | The Mejor Communications | BULK | Jerrold Abc | 6093846532 | 8046 | 08046 |
| ab98aa9e-cba8-42d5-9782-7bd1b033f51b | 2026-05-05 04:00 | Sohaib Ahmad | The Mejor Communications | BULK | Geo Lopez | 7745456745 | 1570 | 01570 |
| 56526fd0-cc0b-4bbe-ae56-44866292b5d6 | 2026-05-05 04:00 | Hussain Farooq | The Mejor Communications | BULK | Lois Andre | 7742388784 | 2668 | 02668 |
| 5932f5bc-0611-4f85-a225-0c7673b5bf4c | 2026-05-05 04:00 | Wishal Robert | The Mejor Communications | BULK | Tom Lally | 6178421166 | 2021 | 02021 |
| 82a424eb-2cc2-4ce2-85ff-f59aabc021f1 | 2026-05-05 04:00 | Wishal Robert | The Mejor Communications | BULK | Joseph Monarca | 8607295401 | 6450 | 06450 |
| 4ecc508b-2d03-4b63-8784-9f2420a6ee55 | 2026-05-06 04:00 | Ahsan Ali | The Mejor Communications | BULK | Joy Desper | 5082829464 | 2019 | 02019 |
| 4f138922-4b6b-48e1-879e-c283ef7a0b9a | 2026-05-06 04:00 | Najeeha Tahir | The Mejor Communications | BULK | (brenda) Pringle | 8436151142 | SC 29575 | 29575 |
| 90d0202b-5bd5-46ff-963d-37dc017effe3 | 2026-05-06 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Scott Ortega | 7326147490 | FL 34275 | 34275 |
| d6cebe10-51c0-4631-9424-7e63caaf7486 | 2026-05-06 04:00 | Hussain Farooq | The Mejor Communications | BULK | Ellen Phillips | 6178930376 | 2184 | 02184 |
| 8c3af21a-ded5-442e-9012-accbf3a3e6f3 | 2026-05-06 04:00 | Sohaib Ahmad | The Mejor Communications | BULK | Alexandrem Abc | 9737040566 | 7307 | 07307 |
| 48a75470-4626-4c96-a851-e0a324d6c750 | 2026-05-06 04:00 | Wishal Robert | The Mejor Communications | BULK | Paul Stanizzi | 6177446396 | 2472 | 02472 |
| e2525d94-3779-4fd3-a668-1e84704eab9e | 2026-05-06 04:00 | Ashban Iftikhar Gill | The Mejor Communications | BULK | Dornevil Abc | 8572943260 | 2472 | 02472 |
| 87a72608-6ac1-487e-baea-e9424ea7f61e | 2026-05-07 04:00 | Mohsin Tariq Ilahi | The Mejor Communications | BULK | Lawrence Pusey | 2127291941 | 7111 | 07111 |
| 223e1aaa-dd7d-4933-83b0-c4192bf1b214 | 2026-05-07 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Diane Gibson | 4345948544 | VA 23837 | 23837 |
| c48a8d60-3716-46c0-afe6-86bede003e6c | 2026-05-07 04:00 | Ashban Iftikhar Gill | The Mejor Communications | BULK | Richard Abc | 2073555185 | 4969 | 04969 |
| de68d7e4-fc2a-414f-a7dc-0de2d730e463 | 2026-05-07 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Rosie Mccall | 2056552460 | Alabama 35173 | 35173 |
| f4a38b6b-60f2-4107-badd-bb53dfa0c119 | 2026-05-07 04:00 | Mohsin Tariq Ilahi | The Mejor Communications | BULK | Salvador Soriano | 9734546506 | 7920 | 07920 |
| b2b35e99-cd5b-4ff9-9533-d71a751cf486 | 2026-05-12 20:15 | M. Abu Zar | Wavetech Infomatics | BULK | Juan Vargas | 3478608371 | 7093 | 07093 |
| bcbd13ac-57a2-4b77-a11e-c757dd867d06 | 2026-05-07 04:00 | Hussain Farooq | The Mejor Communications | BULK | Greg Morrell | 8605584066 | 6033 | 06033 |
| ba20699f-e078-4e3b-9225-d1036cadcb94 | 2026-05-08 04:00 | Muhammad Shazil Nadeem | The Mejor Communications | BULK | Maryann Yutkins | 7812580007 | 1803 | 01803 |
| 23d6b23b-da6a-458a-b81b-64f0b26b41fb | 2026-05-08 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Navelle Thompson | 2022998520 | 20032 Washington, | 20032 |
| b4a1b647-466e-4199-9602-9afbdf39adee | 2026-05-08 04:00 | Maham Zahra | The Mejor Communications | BULK | Mrs. Sherry | 9084778398 | 7027 | 07027 |
| 02def407-9b45-48c4-81d0-fa220ebf762c | 2026-05-12 21:16 | Qasim Suleman | Wavetech Infomatics | BULK | Cheryl Cunningham | 5088924003 | 1524 | 01524 |
| c2edf4d6-8121-4848-b22f-b2c3ec042a8c | 2026-05-08 04:00 | Huzaifa Kaleem | The Mejor Communications | BULK | Sutton Abc | 9788542080 | 2062 | 02062 |
| 19805d8d-d895-4b6e-8e00-3a2937b87881 | 2026-05-19 20:23 | Muhammad Mesum Jawed | The Mejor Communications | MANUAL | Tommy Scottland | 2053061650 | 4468 | 04468 |
| 21b3b55b-6f48-413c-bc87-1a674e8dae29 | 2026-05-08 04:00 | Muhammad Ahmad Amir | The Mejor Communications | BULK | Inna Kaminov | 2012246327 | 7024 | 07024 |
| aa22bb05-e745-4e12-ba7f-879bb137dedb | 2026-05-12 21:44 | Sidra Shahbaz | Wavetech Infomatics | BULK | Darlene Britt | 9738689002 | 7001 | 07001 |
| a0c2e350-3123-4ece-a40a-ca4d7ce5312e | 2026-05-09 04:00 | Hafiz Syed Hassan Trimzi | The Mejor Communications | BULK | Martina Reinstein | 6036895067 | 3052 | 03052 |
| e48cfef5-b74a-4715-bfee-df74e4acc963 | 2026-05-09 04:00 | Daniyal Gill | The Mejor Communications | BULK | Gaudet Abc | 9783993567 | 1475 | 01475 |
| 991a5126-64a8-451b-a8f9-6b954abc19de | 2026-05-09 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Debra Kotaiche | 7272243877 | 33702 FL | 33702 |
| 5a573edf-3a34-4772-a1b8-fe0e158c5589 | 2026-05-12 22:29 | Ameer Hamza | Wavetech Infomatics | BULK | Alice Einhorn | 9734731330 | 7055 | 07055 |
| 78d77e07-c399-495a-894c-007d02a51286 | 2026-05-09 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Janet Cuccia | 5044005949 | LA 70589 | 70589 |
| aa479ad1-2e1f-4eea-84f5-14706302209a | 2026-05-13 15:25 | Muhammad Ahmad | Wavetech Infomatics | BULK | Anton Reinhardt | 7324039730 | 7753 | 07753 |
| 62fac183-9099-4442-ad20-e9f9e80ad445 | 2026-05-09 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Katherine Smith | 9173275822 | FL 34748 | 34748 |
| 0bb0598c-a7cf-4fba-aa5c-62686e7b741a | 2026-05-13 17:15 | Ameer Hamza | Wavetech Infomatics | BULK | Barbara Welch | 2038043407 | 2346 | 02346 |
| 8cb92628-2a91-47f0-87ff-f2337b9f7de7 | 2026-05-13 21:38 | Zaib Un Nisa | Wavetech Infomatics | BULK | Jerrold Scheff | 5083933916 | 1532 | 01532 |
| b240fe44-6308-4672-b312-d0dea017cbea | 2026-05-13 22:50 | Danish Waris | Wavetech Infomatics | BULK | Agnes Wright | 2077633223 | 4847 | 04847 |
| 3946a2d1-0f53-49e5-a7cb-60047b7fdb80 | 2026-05-14 17:40 | Qasim Suleman | Wavetech Infomatics | BULK | Roger Brown | 8604054785 | 6320 | 06320 |
| 9f888d31-5ff1-436f-aac2-77ffaf97440b | 2026-05-15 15:25 | Kashif Saleem | Wavetech Infomatics | BULK | Vicki Rice | 9736322050 | 7034 | 07034 |
| 8264e8ca-8396-4d1e-bf3e-fb419d7f4ce8 | 2026-05-15 17:55 | Raheel Samson | Wavetech Infomatics | BULK | Steven Berlin | 2074235502 | 4064 | 04064 |
| 4e832b55-014a-4d57-b05f-e7af218f2fdf | 2026-05-15 18:26 | Laiba Khan | Wavetech Infomatics | BULK | Chris Sanders | 2039172385 | 6514 | 06514 |
| 078b1d59-376d-413c-97e7-386d398cc690 | 2026-05-15 22:49 | Sidra Shahbaz | Wavetech Infomatics | BULK | Mark Stanton | 8607703662 | 6371 | 06371 |
| b33b94d0-c2ab-4ad0-8b33-a25668734e8a | 2026-05-04 20:22 | Muhammad Taha | EasyTech Communications | BULK | Priscilla Caracter | 6092858303 | 8542 | 08542 |
| 0fa9fd7f-b9ba-4a57-8f6e-a3266b496f89 | 2026-05-04 15:25 | Muhammad Taha | EasyTech Communications | BULK | Timothy Frye | 2038005752 | 6519 | 06519 |
| 7f8b51ce-fe31-4ab2-8bb3-6f8c47079118 | 2026-05-07 23:45 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Catherine Diaz | 7189095192 | 7410 | 07410 |
| 19acb39b-0f3a-4f08-879c-1ed8a7e64be1 | 2026-05-09 20:52 | Hanan Arif | EasyTech Communications | BULK | Marcus Galvan | 8028993015 | 5489 | 05489 |
| 29a0974a-0423-406b-be5b-698f85339923 | 2026-05-11 21:53 | Zain Ul Abidin Ali | EasyTech Communications | BULK | John J Vetere | 9176767972 | 7866 | 07866 |
| 1953370a-e10f-4c1e-8181-413670b1d90e | 2026-05-12 21:31 | M. Mohsin | EasyTech Communications | BULK | James Connors | 6039268726 | 3842 | 03842 |
| 0a71bbc6-089e-4c3f-8fd7-b58130694e47 | 2026-05-13 20:57 | Ali Shan | EasyTech Communications | BULK | Mudassar Shaikh | 8482486054 | 8830 | 08830 |
| 5ec7665f-2915-4ca7-b2a5-5e6027d12060 | 2026-05-14 23:06 | Hanan Arif | EasyTech Communications | BULK | Alfred Cupo | 8604440379 | 6320 | 06320 |
| 5224091a-5317-4e78-8ddc-36c19df213b4 | 2026-05-14 17:41 | Al Riyyan Shahmir | EasyTech Communications | BULK | Michael Graham | 9732393080 | 7044 | 07044 |
| 0fced5dc-7cde-41f2-8eef-78d80a7ddd1a | 2026-05-12 23:16 | Arooj Akbar | EasyTech Communications | BULK | Rae Jean Morin | 2075951391 | 4268 | 04268 |
| 54c7c669-0506-4781-87f1-0108a2b08404 | 2026-05-15 20:45 | Ali Imran | EasyTech Communications | BULK | James Wallace | 6176995871 | 2332 | 02332 |
| 5b5e8884-b528-4b1a-b99a-ac8ba2868e5f | 2026-05-14 18:41 | Arooj Akbar | EasyTech Communications | BULK | Bhagwan Mokate | 8577570931 | 2907 | 02907 |
| 896e259a-ee59-4cab-b515-afe40c9bfd1e | 2026-05-14 16:04 | Al Riyyan Shahmir | EasyTech Communications | BULK | Michael Billings | 8605973480 | 6053 | 06053 |
| 3eac8d2c-5f91-4450-8734-bd697bcc79d9 | 2026-05-13 20:17 | Ali Shan | EasyTech Communications | BULK | Akram Khalil | 7329259599 | 8830 | 08830 |
| 379011b0-f46f-4cdd-a886-d592b00157aa | 2026-05-04 22:57 | M. Mohsin | EasyTech Communications | BULK | James Day | 2076562764 | 4579 | 04579 |
| ab912606-2763-4d80-a0c8-5da7c742ae5f | 2026-05-04 23:21 | Muhammad Umar Mahmood | EasyTech Communications | BULK | George Poole | 5083203379 | 1701 | 01701 |
| e28e3807-fca9-4fa3-b725-9eda267582c1 | 2026-05-06 22:57 | M. Iman Suleman | EasyTech Communications | BULK | Dawn Clark | 5088526837 | 1606 | 01606 |
| 9e8d74f0-5349-4804-a6a4-b05584a1b45b | 2026-05-09 18:41 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Edward Teehan | 9786048124 | 1821 | 01821 |
| 0583e7b0-2e66-420b-a4e7-d2aaf55d43f2 | 2026-05-07 22:49 | Syed Haider Abbas | EasyTech Communications | BULK | Robert Weisel | 3028981574 | 8008 | 08008 |
| 4867e8bd-ad21-43ce-a748-e677749e7b44 | 2026-05-04 15:25 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Kyle Blanchette | 4015954657 | 2169 | 02169 |
| 68220149-0d09-47af-96ac-f5e4d6e3ba4f | 2026-05-06 21:12 | Noman Ahmad | EasyTech Communications | BULK | Theo Ross | 2075832287 | 4040 | 04040 |
| c6ec9432-2e09-4837-b11a-14474381d033 | 2026-05-11 20:51 | Noman Ahmad | EasyTech Communications | BULK | Marguerite Carlson | 8453764436 | 7644 | 07644 |
| f39f27f8-7828-49d7-bc0e-c9e70b66563e | 2026-05-02 20:21 | Haider Waqas Khan | EasyTech Communications | BULK | Cheryl Cheryl | 5088924003 | 1524 | 01524 |
| b8cb9dcf-cef9-4a61-a051-04e23a35f852 | 2026-05-09 04:00 | Muhammad Taha Basit | The Mejor Communications | BULK | Christian Morales | 6094017664 | 7102 | 07102 |
| 4cd4513c-ba54-4191-9e78-aef39c8ffef1 | 2026-05-09 04:00 | Hussain Farooq | The Mejor Communications | BULK | Revlouis Jackson | 8567019145 | 8108 | 08108 |
| 3d814c24-e12e-43ec-82e3-3a4b462ea076 | 2026-05-09 04:00 | Ammara Rasool | The Mejor Communications | BULK | Horst Kolfhaus | 9087536225 | 8889 | 08889 |
| 1eedada3-6ed0-4841-b1d0-fb34b13a5011 | 2026-05-09 04:00 | Abdul Haseeb Malik | The Mejor Communications | BULK | David Brown | 8608330142 | 6106 | 06106 |
| 1c8d98c1-4232-4edc-b959-9eff1114466b | 2026-05-11 04:00 | Muhammad Shazil Nadeem | The Mejor Communications | BULK | Coriolan Abc | 8572722719 | 2184 | 02184 |
| fc14f3dd-5ea5-4b01-a6eb-6469d66d4539 | 2026-05-11 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Lamond Abc | 3523151612 | NC 27501 | 27501 |
| 20eb463f-3f44-4f1e-9697-9993d1310d4c | 2026-05-11 04:00 | Ahsan Ali | The Mejor Communications | BULK | Norris Abc | 9788401969 | 1453 | 01453 |
| 07fef5de-1cff-4d0e-a73f-abf62e6b087e | 2026-05-11 04:00 | Muhammad Fraz Aslam | The Mejor Communications | BULK | Yosef Gulyamov | 6468123381 | 8701 | 08701 |
| 204b84f6-0371-40c2-8550-c4e0ea30f06f | 2026-05-12 04:00 | Muhammad Ayaz | The Mejor Communications | BULK | Peter Bonanno | 9735258978 | 7826 | 07826 |
| 61a2ab7c-d153-4fd0-b7ff-2d9c32907d66 | 2026-05-12 04:00 | Abdul Haseeb Malik | The Mejor Communications | BULK | Mohammed Siddiqui | 7327188170 | 8852 | 08852 |
| 69f0d7be-e49e-4d8f-90ed-b9659a51688d | 2026-05-12 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Mortimer Mentore | 9175849725 | NY 11236 | 11236 |
| 18c7a64a-c42c-40e7-8b87-18880bce0d32 | 2026-05-12 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Thomas Selleck | 6317404632 | Virginia 23467 | 23467 |
| c553e8ce-49a5-43dd-aae6-0883802a1742 | 2026-05-12 04:00 | Mohsin Tariq Ilahi | The Mejor Communications | BULK | Vannay/joseph Thok | 8602621295 | 6457 | 06457 |
| 113c14be-d360-4266-91ff-4a6a2d57df84 | 2026-05-12 04:00 | Mirza Muhammad Haris Baig | The Mejor Communications | BULK | David Price | 2077976533 | 4101 | 04101 |
| cd0fdafe-0d81-49ca-a13e-b3b5255e8fe1 | 2026-05-12 04:00 | Ahsan Ali | The Mejor Communications | BULK | Raymond Giordano | 4015958059 | 2979 | 02979 |
| c63aa1e7-00a0-4835-9a9d-44d6e11405f1 | 2026-05-13 04:00 | Waleed Amjad | The Mejor Communications | BULK | Albert Abc | 7028177469 | 8909 | 08909 |
| d168f050-4cd9-491c-8cca-6a4b237b69c3 | 2026-05-13 04:00 | Maham Zahra | The Mejor Communications | BULK | Michael Deturo | 9736983632 | 7421 | 07421 |
| 2089c390-23b8-47ea-bf3a-d65387685072 | 2026-05-13 04:00 | Waleed Amjad | The Mejor Communications | BULK | Andres Jacobs | 8455190696 | 8902 | 08902 |
| 075e28e7-9538-495b-b6f6-b1b55f6eef6d | 2026-05-13 04:00 | Hafiz Syed Hassan Trimzi | The Mejor Communications | BULK | Charles Chagnon | 6035408000 | 3102 | 03102 |
| b5bee10c-6345-4e76-8caf-98d09be6eb2b | 2026-05-13 04:00 | Huzaifa Kaleem | The Mejor Communications | BULK | Charlesp Abc | 5514273956 | 7006 | 07006 |
| c3508d20-49b8-4233-a207-b39a8581e179 | 2026-05-13 04:00 | Muhammad Fraz Aslam | The Mejor Communications | BULK | Rahul Kulkarni | 3522785952 | 8820 | 08820 |
| 239c3084-4af7-4cbd-b750-b5fb819a8dad | 2026-05-13 04:00 | Sohaib Ahmad | The Mejor Communications | BULK | Joe Baragola | 2154296105 | 8260 | 08260 |
| 1449c2f6-bb71-4a49-a42f-0666d425da24 | 2026-05-13 04:00 | Muhammad Tayyab | The Mejor Communications | BULK | Tony Rice | 6093790652 | 8060 | 08060 |
| 74e00495-f52b-43da-b82c-67fd234ef8f4 | 2026-05-13 04:00 | Aneeq Ali | The Mejor Communications | BULK | Curtis Perry | 2525062667 | 2790 | 02790 |
| 9d45b60a-41f7-4db2-baba-29c0947f2e2e | 2026-05-13 04:00 | Mohsin Tariq Ilahi | The Mejor Communications | BULK | Virginia Landgrebe | 2037700466 | 6776 | 06776 |
| 0ed8d430-13c4-4860-ba32-7bef210fb2b5 | 2026-05-14 04:00 | Taimoor Ahmad | The Mejor Communications | BULK | Shawn Abeth | 5405267421 | 6330 | 06330 |
| 56f3db08-8d3d-4eb3-900b-6efbe59f7cd7 | 2026-05-14 04:00 | Taimoor Ahmad | The Mejor Communications | BULK | Donald Abc | 8438584439 | 2904 | 02904 |
| 949c8eb7-57b4-491e-99f5-0e7f806b5d4e | 2026-05-15 04:00 | Taimoor Ahmad | The Mejor Communications | BULK | Sherri Abc | 6096613430 | 8759 | 08759 |
| fda28bf9-7424-4394-a0fb-b37b00e182d4 | 2026-05-15 04:00 | Muhammad Taha Basit | The Mejor Communications | BULK | Ronnie Mcquitta | 6097358854 | 8015 | 08015 |
| 019bd2ee-08d8-4a32-a39f-b041f5a21135 | 2026-05-15 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Monkiara Johnson | 2296899167 | GA 39840 | 39840 |
| 3dfa62c0-0a52-4436-adfa-ef6ed65de9f5 | 2026-05-08 04:00 | Muhammad Shazil Nadeem | The Mejor Communications | BULK | Frank White | 5089814829 | 1562 | 01562 |
| f196aa88-ac21-4404-86b3-9f270cd1e31b | 2026-05-09 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Miss Bailey | 8043298743 | VA 23234 | 23234 |
| 45afb0ae-bd18-41d6-92a4-67e8a0fd2f07 | 2026-05-11 04:00 | Waleed Amjad | The Mejor Communications | BULK | Adam Chellali | 7818563189 | 2045 | 02045 |
| b1c8cdfc-5b06-4ac4-b42f-985b22473b89 | 2026-05-13 04:00 | Nishat Nasir | The Mejor Communications | BULK | Victor Abc | 8485257444 | 7728 | 07728 |
| ac73d430-5a2d-4585-a9f1-cf89b9810e00 | 2026-05-05 23:22 | Al Riyyan Shahmir | EasyTech Communications | BULK | Mitchell Ullery | 2038043790 | 6510 | 06510 |
| cef20972-3f92-4695-9143-56dbed2da67c | 2026-05-02 18:23 | John Abraham | Wavetech Infomatics | BULK | Darlene Williams | 2039880702 | 6511 | 06511 |
| 432af9af-5957-4f94-81b0-2d6002a284f8 | 2026-05-07 18:57 | Mubeen Jabbar | Wavetech Infomatics | BULK | Richard Starek | 7742754329 | 1501 | 01501 |
| 4ba2dbec-ae5b-44be-9c08-f2fb5e10bf4e | 2026-05-09 17:36 | Kashif Saleem | Wavetech Infomatics | BULK | Joyce Blake | 8607292178 | 6111 | 06111 |
| 7f81d5a5-7023-469d-8248-1349e247af04 | 2026-05-11 22:47 | Sabir Ali Azan | Wavetech Infomatics | BULK | Dennis Telischak | 9736321385 | 7012 | 07012 |
| 8151d2e4-4813-48e6-936c-64f44549e75b | 2026-05-13 17:19 | John Abraham | Wavetech Infomatics | BULK | Daniel Brewer | 8604620321 | 6226 | 06226 |
| 2acdad19-8f90-4774-a061-f08130ed70bc | 2026-05-01 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Deborah Colbert | 7046496148 | 27610 NC | 27610 |
| 0f44c8a8-5d72-4772-ae39-1d3b7cd65d36 | 2026-05-02 04:00 | Muhammad Shazil Nadeem | The Mejor Communications | BULK | Kevin Cote | 2074916795 | 4982 | 04982 |
| 23ae19e8-87a8-42df-87a7-4b7ce478b36d | 2026-05-04 04:00 | Huzaifa Kaleem | The Mejor Communications | BULK | Victoria Dodge | 6034965907 | 3224 | 03224 |
| 26109cd0-7465-43d5-8a7b-9d6948a74bd8 | 2026-05-04 04:00 | Ali Hamza | The Mejor Communications | BULK | Jordan Abc | 8607592706 | 6118 | 06118 |
| 3be33d61-4fcf-4c37-9f0f-9217aa51cc95 | 2026-05-05 04:00 | Huzaifa Kaleem | The Mejor Communications | BULK | Naiken Perumal | 9176587901 | 7305 | 07305 |
| a38cebb5-b28a-4dbc-97c0-4257dc8fc837 | 2026-05-06 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Thomas Rowell | 3043755909 | wv 26187 | 26187 |
| d3d3110e-e09f-496a-a7ae-f10194073e15 | 2026-05-06 04:00 | Mohsin Tariq Ilahi | The Mejor Communications | BULK | Raymond Bassett | 4015360025 | 2916 | 02916 |
| 2c43fd17-0eb6-420c-b6f7-97ae7c550e74 | 2026-05-07 04:00 | Muhammad Tayyab | The Mejor Communications | BULK | Elizabeth Taylor | 8609171659 | 6330 | 06330 |
| df80fbc7-2d75-4ca6-addb-531a91482b17 | 2026-05-07 04:00 | Ali Hamza | The Mejor Communications | BULK | Adam Chellali | 7818563189 | 2420 | 02420 |
| f0be9678-8668-441b-aea5-7c87b2825e13 | 2026-05-07 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Priscila Martinez | 3082252860 | TX 75071 | 75071 |
| 817f21e7-47c9-4577-9544-c4e1a6bfa728 | 2026-05-07 04:00 | Sohaib Ahmad | The Mejor Communications | BULK | David Theriault | 6038098117 | 3054 | 03054 |
| 2ce79b2b-9ecc-4e80-ba46-8f41c8bf177e | 2026-05-07 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Luis Chavez | 7203151870 | CO 80125 | 80125 |
| 18d49da5-e1b2-4daa-b691-62942013080c | 2026-05-07 04:00 | Waleed Amjad | The Mejor Communications | BULK | Brian Vincent | 2039419480 | 6484 | 06484 |
| 715b9487-c714-4b4e-bc6f-981f7d30c930 | 2026-05-07 04:00 | Azeem Nadeem | The Mejor Communications | BULK | Robert Mallett | 4016416848 | 109 Eton Ave | 00109 |
| c91c8427-32ca-4a0a-be82-5082340e45c2 | 2026-05-07 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Victor Checo | 7864772686 | FL 33125 | 33125 |
| 0094d32f-80d1-4694-a77a-aad8957ab2b3 | 2026-05-08 04:00 | Abdul Haseeb Malik | The Mejor Communications | BULK | Leslie Bojko | 2032323313 | 6492 | 06492 |
| a695a970-565e-4e02-8edd-49cd2a267d7e | 2026-05-08 04:00 | Ali Hamza | The Mejor Communications | BULK | Rosemarie Hight | 9086892379 | 7863 | 07863 |
| 7046ace1-5202-47d0-9ec6-4570e4d2dc4c | 2026-05-08 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Marsha Jackson | 9034405721 | tx 75431 | 75431 |
| 7e32f7d4-bbf5-43b1-bf50-d0ca8f414b66 | 2026-05-08 04:00 | Ali Hamza | The Mejor Communications | BULK | Marilyn Grabowski | 9084151365 | 8742 | 08742 |
| c1f339ac-7700-4b26-bd1a-c274ae081222 | 2026-05-09 04:00 | Hafiz Syed Hassan Trimzi | The Mejor Communications | BULK | James Holmes | 9736985040 | 7112 | 07112 |
| 6ed54005-77db-4be0-a249-3585f1055cac | 2026-05-11 04:00 | Muhammad Tayyab | The Mejor Communications | BULK | Timmy Martin | 6032755460 | 3301 | 03301 |
| 755a8922-4509-4268-a84f-bbed9ad34685 | 2026-05-11 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Ann Murphy | 6037336850 | NH 03838 | 03838 |
| 6dda76fa-2804-450b-855c-5843075229bf | 2026-05-11 04:00 | Ahsan Ali | The Mejor Communications | BULK | Edward Immar | 7818431022 | 2184 | 02184 |
| cf6a0ab6-b953-4f4a-a38c-a0cf79d2a858 | 2026-05-11 04:00 | Muhammad Tayyab | The Mejor Communications | BULK | Morad Mustafa | 9734326522 | 7011 | 07011 |
| f21458dc-50bf-4a4b-b546-9a33efa9af4c | 2026-05-12 04:00 | Mirza Muhammad Haris Baig | The Mejor Communications | BULK | Rita Bouchard | 2077286059 | 4401 | 04401 |
| 028568d5-6729-4b20-89dd-0cadc71e7080 | 2026-05-14 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Odell Cain | 3366125518 | NC 27006 | 27006 |
| d0fdc7c4-8a6a-4b57-ac71-6b92d5a24064 | 2026-05-14 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Robert Canfield | 2317255718 | MI 49442 | 49442 |
| e3a5d776-9b4c-4b83-9094-fe0c27ccb23b | 2026-05-15 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Robin Cook | 8605261937 | 6001 | 06001 |
| 1db79549-8343-4068-a1ef-5a74cb485b94 | 2026-05-15 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Jackie Cleveland | 2513441978 | 35242 AL | 35242 |
| dd534f14-0725-403b-98f0-3d0558e84a5d | 2026-05-15 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Dalton Scafe | 9843510833 | NC 27330 | 27330 |
| 390f3129-0c6c-4bfa-ae68-e48a9706fbd6 | 2026-05-11 04:00 | Najeeha Tahir | The Mejor Communications | BULK | Dennis Haas | 9737146001 | NJ 07866 | 07866 |
| 5a2d10fb-9f1b-4403-ac67-6c6a1ed4a65a | 2026-05-08 04:00 | Wishal Robert | The Mejor Communications | BULK | Dennis Haas | 9737146001 | 7866 | 07866 |
| 45a2692a-3d41-44a4-a03f-79def762c214 | 2026-05-06 04:00 | Mohsin Tariq Ilahi | The Mejor Communications | BULK | Frank White | 5089814829 | 1562 | 01562 |
| e28bf2d2-b74e-4078-81db-3e58b4cc0210 | 2026-05-08 04:00 | Ahsan Ali | The Mejor Communications | BULK | Rodrigues Abc | 6174872962 | 2118 | 02118 |
| cfbcb26b-4930-40ed-8061-6aef53d54f91 | 2026-05-08 04:00 | Maham Zahra | The Mejor Communications | BULK | Frances Mandile | 5083592008 | 2052 | 02052 |

---

## 8. ZIP — junk values, no fix (408 rows)

Values like `-`, state abbreviations (`FL`, `AZ`), or other non-zip text. NULL them; the row keeps everything else.

| id | created_at | created_by | company | batch | customer | phone | BAD zip | action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8e737548-bead-482d-94e5-273d762b5e4d | 2026-05-08 18:48 | Huzaifa Shafiq | EasyTech Communications | BULK | Kelly Norris | 3032535478 | - | NULL |
| 757294bf-3b2e-4a2b-a874-d203236bfee3 | 2026-05-04 22:11 | Muhammad Bilal | Wavetech Infomatics | BULK | Andy Hernandez | 5202191873 | - | NULL |
| 3be67363-c376-4ce6-af99-d1fb5e13341f | 2026-05-04 22:11 | Muhammad Ahmad | Wavetech Infomatics | BULK | Harris Knight | 2516801210 | - | NULL |
| 1e3ae91e-016b-4ca2-993c-0d3f17d80ac2 | 2026-05-04 22:12 | M Noman | Wavetech Infomatics | BULK | Doyle Rouse | 3363010756 | - | NULL |
| 8a37c620-bef1-44e3-9e7e-a5dfc1c29872 | 2026-05-04 22:18 | Raheel Samson | Wavetech Infomatics | BULK | Joy Agpaoa | 8082249169 | - | NULL |
| 152d2204-10bd-4e7a-af8d-828f5657bd55 | 2026-05-04 22:29 | M. Haris Zahid | Wavetech Infomatics | BULK | Jamal Mahmoud | 2015772396 | - | NULL |
| 8e063da2-66d7-4b7c-87b7-fa6416bc76eb | 2026-05-04 22:38 | M. Haris Zahid | Wavetech Infomatics | BULK | Thomas Barber | 3863371495 | - | NULL |
| 8ecab90d-553f-4d49-9360-1dc051613798 | 2026-05-04 22:32 | Waleed Ali | Wavetech Infomatics | BULK | Lisa Cooper | 5025928549 | - | NULL |
| 0e1bedcf-a190-486e-a589-f7fd41fd8d9e | 2026-05-04 22:35 | Zaib Un Nisa | Wavetech Infomatics | BULK | Edna Larue | 5405897514 | - | NULL |
| 784181e7-f379-438e-9faa-392ad5e7e385 | 2026-05-04 22:35 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Roberte Jankowski | 4073214101 | - | NULL |
| afae86bc-7fee-4d55-8117-3c553db80d7f | 2026-05-04 22:39 | John Abraham | Wavetech Infomatics | BULK | Sylvia Ortega | 5756548111 | - | NULL |
| 761941c4-f684-41b4-bff1-e09b4a15823c | 2026-05-04 22:40 | Hafiz Farhan Sadaqa | Wavetech Infomatics | BULK | Clarice Snider | 3523025438 | - | NULL |
| 8d22b3db-f30e-4264-8eda-ec09f8507073 | 2026-05-04 22:45 | Malahim Babar | Wavetech Infomatics | BULK | Valerie Taylor | 6014350211 | - | NULL |
| 4f41648a-3172-4195-8589-b43103a4eff2 | 2026-05-04 22:47 | M Mohsin | Wavetech Infomatics | BULK | Douglas Neiger | 9135154301 | - | NULL |
| f3b947f0-3f5c-4e70-8fbe-931b3332cb93 | 2026-05-04 22:48 | Mubeen Jabbar | Wavetech Infomatics | BULK | Matt Eaton | 7274668790 | - | NULL |
| aafabc41-25a0-49de-ba9f-405e3ee602f0 | 2026-05-04 22:56 | M Noman | Wavetech Infomatics | BULK | Nathaniel Baxter | 7018924107 | - | NULL |
| 8e199912-4e07-4998-b0f9-89f7494e5389 | 2026-05-04 22:59 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Jack Goodman | 9144748132 | - | NULL |
| 34cca86d-c5fc-4d11-956d-35f5c8d05806 | 2026-05-04 23:04 | M. Haris Zahid | Wavetech Infomatics | BULK | Larry Crabb | 2817280218 | - | NULL |
| 7d4f6b47-eca2-4be6-aa42-27fe90da23bb | 2026-05-04 23:11 | Muhammad Ahmad | Wavetech Infomatics | BULK | Connie Davis | 6073165445 | - | NULL |
| 2adf09bb-69ca-49dd-9ba4-f10e2b5776c0 | 2026-05-04 23:04 | Muhammad Ahmad | Wavetech Infomatics | BULK | Garland Stacks | 5015145006 | - | NULL |
| c98af21b-c84e-42e7-8d80-bef03a5b482b | 2026-05-04 23:05 | M Noman | Wavetech Infomatics | BULK | Victor Dixon | 6025250039 | - | NULL |
| 56604076-9fd7-40e8-9af4-7871ccd71621 | 2026-05-04 23:18 | John Abraham | Wavetech Infomatics | BULK | Juana Linares | 9704710521 | - | NULL |
| 422cdd20-1d44-47a6-9452-47cee5053dee | 2026-05-04 23:22 | Qasim Suleman | Wavetech Infomatics | BULK | Rita Barron | 3039616418 | - | NULL |
| 0c22c036-fc76-4cf5-9101-eb4876f0d7d9 | 2026-05-04 23:26 | M. Haris Zahid | Wavetech Infomatics | BULK | Iris Bellson | 5202589059 | - | NULL |
| 567d749a-766c-4a09-ba86-3e671ff8cc60 | 2026-05-04 23:38 | M Rizwan | Wavetech Infomatics | BULK | Donald Butler | 8438010707 | - | NULL |
| 2f73d3c2-40c5-45ac-9119-d41445eab6ab | 2026-05-04 23:39 | Fatima Wajid | Wavetech Infomatics | BULK | Pamela Crain | 8639445415 | - | NULL |
| 7cdce4ff-90bc-4d43-8b30-f5d1fdfb96e4 | 2026-05-04 23:42 | M Noman | Wavetech Infomatics | BULK | Tonie Wurster | 3085206661 | - | NULL |
| 9a787ca9-4509-4971-a287-b0640e3a3ff1 | 2026-05-05 16:16 | Touseef Ahmad | Wavetech Infomatics | BULK | Leroy Morris | 6182036515 | - | NULL |
| 24903a7a-b7c5-4d75-a77c-41251504b72d | 2026-05-05 16:30 | Ameer Hamza | Wavetech Infomatics | BULK | Theresa Johnson | 6067061762 | - | NULL |
| 990b904b-f172-48ec-a99f-6b878203d6e0 | 2026-05-05 16:00 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Richard Peterson | 5152290360 | - | NULL |
| 8b02968d-ce25-4538-b6bb-b806f1977b1e | 2026-05-05 16:02 | Sabir Ali Azan | Wavetech Infomatics | BULK | Megan Elizabeth Gray | 8179917554 | - | NULL |
| 2dffa8b9-1ff9-484e-b430-dfce30cc0023 | 2026-05-05 16:08 | Muhammad Bilal | Wavetech Infomatics | BULK | Victor Harding | 8485257444 | - | NULL |
| b0ab6ca0-2be9-4d95-b24b-9236de087a5d | 2026-05-05 16:13 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Katelyn Ball | 2676361485 | - | NULL |
| 34c8bad0-5384-4140-b1d9-e40ec154298c | 2026-05-05 16:19 | Ameer Hamza | Wavetech Infomatics | BULK | Deng Chantharath | 5073298614 | - | NULL |
| f0222b50-22ef-4d32-a361-a8401443f4b7 | 2026-05-05 16:28 | Sabir Ali Azan | Wavetech Infomatics | BULK | Robert Konen | 4079730862 | - | NULL |
| 1605f31d-3d3f-463c-a46a-f6ec9823b2f8 | 2026-05-05 16:41 | M Mohsin | Wavetech Infomatics | BULK | Robert Miller | 2252700298 | - | NULL |
| 1eee5d91-a957-4b5e-a6eb-85310bf7f0c9 | 2026-05-05 16:41 | Ameer Hamza | Wavetech Infomatics | BULK | Noheli Luna | 5743265289 | - | NULL |
| e8940f01-c526-4b26-b665-cebfa735e3db | 2026-05-05 16:51 | Kashif Saleem | Wavetech Infomatics | BULK | John Sanchez | 8622239000 | - | NULL |
| 721dac33-1a37-4b49-8e30-fa443b9c803b | 2026-05-13 17:49 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Raymond Essendrup | 7632338596 | - | NULL |
| 06ac8282-a496-41a8-ac5b-9e56f436c503 | 2026-05-05 17:03 | John Abraham | Wavetech Infomatics | BULK | Carolyn Donato | 9412844370 | - | NULL |
| 5fef5b15-3444-4055-abe7-cb99b0103cd1 | 2026-05-05 20:12 | Malahim Babar | Wavetech Infomatics | BULK | Bruce Stone | 8055010171 | - | NULL |
| a8ceaac6-50ae-4f8f-acdb-7d75bf43e120 | 2026-05-05 17:12 | Zaib Un Nisa | Wavetech Infomatics | BULK | Victoriaa Hansen | 4358403664 | - | NULL |
| b6b3bab4-21d5-4998-a679-2b8e0836a289 | 2026-05-05 17:18 | Muhammad Ahmad | Wavetech Infomatics | BULK | Peggya Simon | 7135163031 | - | NULL |
| b4141982-1184-44ee-8da7-8fe7868c54fc | 2026-05-05 17:21 | M Rizwan | Wavetech Infomatics | BULK | Jeffrey Melendez | 6127030183 | - | NULL |
| 37596b8e-1397-4d7f-b490-cb38ffc4007c | 2026-05-05 17:33 | Rehan Shah | Wavetech Infomatics | BULK | Eugene Grossey | 3525047781 | - | NULL |
| 7badebb1-0690-4f31-827b-d0ee146cf19a | 2026-05-05 17:41 | Kashif Saleem | Wavetech Infomatics | BULK | Oliver Tracy | 7023264397 | - | NULL |
| bf083e52-cae0-4467-aad8-94815ac2403e | 2026-05-05 17:46 | Zaib Un Nisa | Wavetech Infomatics | BULK | Keyana George | 9193668724 | - | NULL |
| 858ceb07-8b64-4569-a1de-d05143eca4d5 | 2026-05-05 17:48 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Daniel Wilborn | 3347071884 | - | NULL |
| e4e6ecb4-1f13-44b1-9dd5-2f824cf40b07 | 2026-05-05 17:51 | Laiba Khan | Wavetech Infomatics | BULK | Warren Meyer | 7139627481 | - | NULL |
| ff2c9a0a-c013-42d6-90bd-dd84ca27dd4d | 2026-05-05 18:00 | Daud Rehman | Wavetech Infomatics | BULK | Vern Carl | 5078200057 | - | NULL |
| 108053a1-5be4-4763-b4f4-04ab28d5d7d8 | 2026-05-05 18:04 | M. Abu Zar | Wavetech Infomatics | BULK | Vicki Warner | 4322582661 | - | NULL |
| 9f170c69-f1b6-4a6f-b0d5-05c0c1ca2bef | 2026-05-05 18:04 | Touseef Ahmad | Wavetech Infomatics | BULK | Terrilyn Moore | 8023797991 | - | NULL |
| a8d77584-b7e7-4663-a81a-8787a1d67e19 | 2026-05-05 18:07 | Sabir Ali Azan | Wavetech Infomatics | BULK | Romeo Valentin | 8039689114 | - | NULL |
| 18e41890-0263-456a-b389-8dc3b05a8ee6 | 2026-05-05 18:13 | Hafiz Farhan Sadaqa | Wavetech Infomatics | BULK | Bobbyandalice Fincher | 4709096619 | - | NULL |
| 0a94b190-6400-49d7-ac07-51c105c1266f | 2026-05-05 18:18 | Fiza Aslam | Wavetech Infomatics | BULK | Randye Shears | 2089836332 | - | NULL |
| 270352ba-bcfa-4d8d-8027-51109a3bd7d9 | 2026-05-05 18:19 | Laiba Khan | Wavetech Infomatics | BULK | Eddie Asterson | 7044187175 | - | NULL |
| 71c1d53c-4ec4-498b-b347-c97e2f19470a | 2026-05-05 18:24 | Muhammad Bilal | Wavetech Infomatics | BULK | Greg Hill | 8014140858 | - | NULL |
| 5905c79a-fe83-42a8-84f5-64219cd988e2 | 2026-05-05 18:32 | Ameer Hamza | Wavetech Infomatics | BULK | Harvest Newton | 8638019987 | - | NULL |
| e9157353-250c-427a-9b64-70d0bf1d5a80 | 2026-05-05 18:36 | Ameer Hamza | Wavetech Infomatics | BULK | Codie Miller | 4354960972 | - | NULL |
| b81c68f5-0f9e-4ccc-b39f-3786f8d42304 | 2026-05-05 18:42 | John Abraham | Wavetech Infomatics | BULK | Christopher Finley | 7316302265 | - | NULL |
| df186034-9274-45e5-bea1-8dbbf3218966 | 2026-05-05 18:43 | Mubeen Jabbar | Wavetech Infomatics | BULK | Robert Oliver | 9185770177 | - | NULL |
| d37d6cbb-f658-4540-9be0-d9fe041c3c5c | 2026-05-08 17:55 | M Mohsin | Wavetech Infomatics | BULK | Allen Mickle | 7082247423 | - | NULL |
| 744f5fd3-39e2-4a01-bfb1-fdb5034f5914 | 2026-05-08 18:44 | Kashif Saleem | Wavetech Infomatics | BULK | Jerry Hoover | 8143298389 | - | NULL |
| 2c8179ec-1aa7-4407-a5be-5856425ea091 | 2026-05-05 22:28 | Sidra Shahbaz | Wavetech Infomatics | BULK | Sammy Gilstrsp | 4702448447 | - | NULL |
| 78ac9186-1509-4ad6-a0b0-00d0fc5f964c | 2026-05-05 22:51 | Malahim Babar | Wavetech Infomatics | BULK | John James | 9282373069 | AZ | NULL |
| 468609e5-519b-4515-8ad1-d5143317da7b | 2026-05-05 22:56 | Waleed Ali | Wavetech Infomatics | BULK | Rosemary Ross | 7737791312 | IL | NULL |
| 30919a2c-ea59-4202-830a-75afcdcc44e6 | 2026-05-06 20:39 | Touseef Ahmad | Wavetech Infomatics | BULK | John Annino | 8603028788 | CT | NULL |
| 026825cc-cd41-4844-bb91-ad6dcc3a646a | 2026-05-06 21:13 | Qasim Suleman | Wavetech Infomatics | BULK | Mark Kaufman | 7189485842 | FL | NULL |
| c5204c36-121e-49ef-bca5-355515bd1ffd | 2026-05-29 22:58 | Ali Imran | EasyTech Communications | MANUAL | Marie Lowe | 5049096661 | 700022010 | NULL |
| b38138d1-3ad2-41a9-9e64-d5c34e77a3ad | 2026-05-06 23:45 | Malahim Babar | Wavetech Infomatics | BULK | Barry Sonnenfeld | 9186073620 | - | NULL |
| cb78b0fb-77dd-4ca2-a7c4-368c829007be | 2026-05-07 17:33 | Danish Waris | Wavetech Infomatics | BULK | Paul George | 5036606795 | OR | NULL |
| e92ac805-5ce8-4ae0-b7f1-d1e9c00a754b | 2026-05-07 20:27 | Touseef Ahmad | Wavetech Infomatics | BULK | Arun Kumar | 8608151967 | - | NULL |
| 86e34c7e-ce8e-44a6-a2bd-136a460823c4 | 2026-05-07 21:17 | Malahim Babar | Wavetech Infomatics | BULK | Radie Nedlin | 5613067438 | FL | NULL |
| 663c3d74-93ab-4bb2-8a51-e38fa9d8bea0 | 2026-05-06 22:36 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Rogelio Abc | 9122531094 | - | NULL |
| 548f289a-888b-4a9f-84d5-b5df39810223 | 2026-05-06 22:38 | Tahrim Fatima | Wavetech Infomatics | BULK | Buddhi Gurung | 4126285600 | 15227-3627 | NULL |
| 3774b0df-30d8-4314-a11e-4a8b1d62f23f | 2026-05-07 21:22 | Muhammad Ahmad | Wavetech Infomatics | BULK | Armando De Oliveira | 9452164938 | TX | NULL |
| bb7fcc97-ab42-4b6a-925c-924ccf535e31 | 2026-05-07 21:43 | M Mohsin | Wavetech Infomatics | BULK | Mechel Berkowitz | 8452487211 | NY | NULL |
| 71e54796-cab9-47a1-beb7-e6b1f3c9e5cc | 2026-05-06 22:40 | Raheel Samson | Wavetech Infomatics | BULK | Jason Abc | 2027109092 | - | NULL |
| ac958146-6a72-4697-8c2f-7ef63df199cd | 2026-05-06 22:42 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Tom Selesnik | 7248372296 | - | NULL |
| 3ba4a512-caff-44ea-944e-511e6b8d694e | 2026-05-07 23:18 | Ameer Hamza | Wavetech Infomatics | BULK | Santiago Curchitser | 4808130005 | AZ | NULL |
| aaec0cd7-42d7-4c00-a02a-645bcf4243cb | 2026-05-08 17:43 | Ameer Hamza | Wavetech Infomatics | BULK | Fred Stoufer | 7074813958 | - | NULL |
| 3968260a-f991-4cab-9933-eeb34c0ddb43 | 2026-05-08 18:47 | Zaib Un Nisa | Wavetech Infomatics | BULK | Rodolfo Nunez | 3127305515 | IL | NULL |
| 6670a5e0-e3d4-41b8-8d71-624766f13878 | 2026-05-08 18:56 | Sabir Ali Azan | Wavetech Infomatics | BULK | Dominique Quiller | 8037682832 | - | NULL |
| 722c8fcb-9beb-4073-84d7-b800a34f32d2 | 2026-05-06 23:24 | Sabir Ali Azan | Wavetech Infomatics | BULK | Chantell Rodriguez Chevalier | 2035082816 | - | NULL |
| 43514c71-4c69-49ae-a0cf-34615195c654 | 2026-05-08 20:15 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Audra Gordon | 4108317999 | - | NULL |
| 6230855b-9eb1-4bab-9c01-37f797b3ab33 | 2026-05-07 20:11 | Muhammad Bilal | Wavetech Infomatics | BULK | Richard Magnus | 7344784494 | - | NULL |
| b9395706-b6c5-447e-8899-221817f864c3 | 2026-05-07 20:28 | Waleed Ali | Wavetech Infomatics | BULK | Richard Olish | 6312559602 | - | NULL |
| 1a7b8437-12eb-4e76-861a-5b5ac2a9713a | 2026-05-07 20:33 | Touseef Ahmad | Wavetech Infomatics | BULK | Victoria Abc | 9565361801 | - | NULL |
| 75337935-a6d2-4047-8d6c-74974223898c | 2026-05-07 23:55 | Mubeen Jabbar | Wavetech Infomatics | BULK | Barry Meador | 5403845061 | 24019-0251 | NULL |
| 9a39bc76-8085-4135-8678-ec77d2487c74 | 2026-05-08 17:15 | Farrukh Saleem | Wavetech Infomatics | BULK | Gloria Martinez | 5757708636 | - | NULL |
| a7ccf725-1a02-40f8-bf99-2f3f573a294b | 2026-05-08 17:18 | M. Abu Zar | Wavetech Infomatics | BULK | Herbert Heath | 9047108863 | - | NULL |
| 396ca547-db19-4032-8066-658782ac0cca | 2026-05-08 17:22 | M Noman | Wavetech Infomatics | BULK | Venkataraghurampra Neeli | 7044538283 | - | NULL |
| 2da7fb66-84ea-4f36-8e8f-430280105c02 | 2026-05-08 17:31 | Laiba Khan | Wavetech Infomatics | BULK | Brenda Armenteros | 8135260152 | - | NULL |
| 66072f6b-63f9-4511-b6a8-8c33fce6294d | 2026-05-08 17:32 | M Mohsin | Wavetech Infomatics | BULK | Pam Green | 2256036405 | - | NULL |
| 63290995-ebc4-4583-9861-3f19c11587a3 | 2026-05-08 17:35 | Waleed Ali | Wavetech Infomatics | BULK | Kenneth Dolida | 9089630658 | - | NULL |
| 2e9e11c5-7ff6-4544-b771-5ad43e9cafa5 | 2026-05-08 17:39 | Zaib Un Nisa | Wavetech Infomatics | BULK | Abraham Gonsalez | 7733226850 | - | NULL |
| 4daa1380-f0f1-42ba-a4a9-26ec597ccd42 | 2026-05-08 17:41 | M Noman | Wavetech Infomatics | BULK | Joyce Schwertan | 9369331592 | - | NULL |
| 8d643025-66f6-49d9-a002-258b22d4fcb5 | 2026-05-08 17:53 | Touseef Ahmad | Wavetech Infomatics | BULK | Jackie Gahagen | 7727855969 | - | NULL |
| 92143385-1be2-4b21-b5a9-76d15be1ee33 | 2026-05-08 18:01 | Ameer Hamza | Wavetech Infomatics | BULK | Eric Digruttolo | 9416850398 | - | NULL |
| a2cb2cca-518b-48fa-8fe4-19e86606c1cd | 2026-05-08 18:07 | Waleed Ali | Wavetech Infomatics | BULK | Emalyn Bryner | 3026034448 | - | NULL |
| bce705de-b5a4-4233-b73d-e81c20bc337d | 2026-05-08 18:12 | Waleed Ali | Wavetech Infomatics | BULK | Tim Clounch | 5209043004 | - | NULL |
| 5152da86-ca93-4558-8e28-a64ab8fa6859 | 2026-05-08 18:13 | M. Abu Zar | Wavetech Infomatics | BULK | Gordon Madere | 2253289082 | - | NULL |
| f9aaa31b-0746-43ab-a9c9-d02e8612c72d | 2026-05-08 18:15 | Ameer Hamza | Wavetech Infomatics | BULK | Lara Tucker | 3255148351 | - | NULL |
| b6519754-2065-47cd-be85-d44939f94ccb | 2026-05-08 18:19 | M Mohsin | Wavetech Infomatics | BULK | Darryl Dawkins | 8038002298 | - | NULL |
| 587fff54-fec8-4237-9fcc-1b20b4f6aac3 | 2026-05-08 18:21 | M. Abu Zar | Wavetech Infomatics | BULK | Steven Lord | 9726722860 | - | NULL |
| 62c1adc7-ec0c-48bd-88cf-bf1e83cccff6 | 2026-05-08 18:24 | John Abraham | Wavetech Infomatics | BULK | Tamira Parron | 7737095097 | - | NULL |
| 587fda55-237c-433b-ba3f-ba2c5d495a76 | 2026-05-08 18:24 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Janicem Kimmel | 4043334323 | - | NULL |
| 36127766-b715-43b3-b0c3-5f22e20208d1 | 2026-05-08 18:30 | Qasim Suleman | Wavetech Infomatics | BULK | Earl Ratcliffe | 8602073470 | - | NULL |
| 7feedb48-87e3-4b5b-9926-69b2bceb509d | 2026-05-08 18:30 | M. Abu Zar | Wavetech Infomatics | BULK | Brandon Murphy | 8154046562 | - | NULL |
| a6762799-d935-40e1-8799-de61a96ea208 | 2026-05-08 18:33 | M Noman | Wavetech Infomatics | BULK | Preston Bettis | 5177497753 | - | NULL |
| f6af5be2-566c-4369-a54a-83c9184751e0 | 2026-05-08 18:33 | Ameer Hamza | Wavetech Infomatics | BULK | Bharat Patel | 6167170856 | - | NULL |
| 71b74c2e-484a-4a78-a0ea-e321dbff4cc1 | 2026-05-08 18:36 | John Abraham | Wavetech Infomatics | BULK | Michael Nicholas | 6306499832 | - | NULL |
| e2beec17-e3ff-44d7-89ff-3d272036e8c2 | 2026-05-08 18:43 | M. Haris Zahid | Wavetech Infomatics | BULK | Linda Tengwall | 6122670413 | - | NULL |
| 4507414f-aec4-400b-b9aa-dfb38e965039 | 2026-05-08 18:45 | Qasim Suleman | Wavetech Infomatics | BULK | Richard Knight | 3612050620 | - | NULL |
| d06128d1-1343-4336-a575-07d959e7ad54 | 2026-05-08 18:53 | Daud Rehman | Wavetech Infomatics | BULK | Ulans Melanie | 6107306656 | - | NULL |
| 57761594-3fea-4678-9ac0-978ecf86ab6b | 2026-05-08 20:05 | Ameer Hamza | Wavetech Infomatics | BULK | Tim Mackin | 8047310984 | - | NULL |
| 9fea31b1-7470-443e-9478-3d321b38c980 | 2026-05-08 20:07 | Danish Waris | Wavetech Infomatics | BULK | Lewis James | 4104597942 | - | NULL |
| 4870f712-8409-4f9d-8965-07b4f8d22c1e | 2026-05-08 20:09 | Kashif Saleem | Wavetech Infomatics | BULK | Eugene Durant | 6235460564 | - | NULL |
| 5e85e3f7-ada3-459d-b40f-21dd16c8e356 | 2026-05-08 20:11 | Rehan Shah | Wavetech Infomatics | BULK | Osie Deel | 7068899082 | - | NULL |
| 321fe064-5706-48ec-ba80-909cf2fd547b | 2026-05-05 04:00 | Onyx | Onyx | BULK | Leonard Mcgill | 7204660285 | 177001 | NULL |
| 055f6281-01d7-48a0-94f2-f37b6ed34400 | 2026-05-08 20:22 | M. Haris Zahid | Wavetech Infomatics | BULK | Rebecca Carter | 2533585398 | - | NULL |
| 8470a3dd-0757-4b8e-a6a5-68d12bf7ebde | 2026-05-08 20:22 | Malahim Babar | Wavetech Infomatics | BULK | Brenda Bailey | 2035004509 | - | NULL |
| c48f217b-7708-4c40-ab22-c271e61663e1 | 2026-05-08 20:39 | M. Abu Zar | Wavetech Infomatics | BULK | Joseph Dibenedetto | 2035009609 | - | NULL |
| e62588e1-11b2-4d3d-8cb6-c183f4817e30 | 2026-05-01 21:20 | Rana Muhammad Bilal | EasyTech Communications | BULK | Terry Marler | 6183806776 | - | NULL |
| 9e0b0198-e98b-4251-982d-84dcfedb7413 | 2026-05-04 18:01 | Muhammad Bilal | Wavetech Infomatics | BULK | Beth Batchelder | 4047028228 | - | NULL |
| 76d4b707-187f-43c7-bc98-bac3e3a17175 | 2026-05-04 21:48 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Rachelle&john Donaldson | 6073466215 | - | NULL |
| f812ab0b-5a08-41fa-8d0c-8ca16e7cf663 | 2026-05-04 21:42 | Malahim Babar | Wavetech Infomatics | BULK | Angel Lopez | 8593823990 | - | NULL |
| 341e62ab-6e65-48b5-adf6-dbfe6ca067f4 | 2026-05-02 17:12 | Ali Imran | EasyTech Communications | BULK | Satish Ramani | 4792832138 | - | NULL |
| f1e5305d-e276-467d-9149-14713f8b7aaf | 2026-05-02 22:06 | M. Iman Suleman | EasyTech Communications | BULK | Ernest Fuller | 2038867855 | - | NULL |
| d120a772-55b5-4c78-b73c-abcaa30404cd | 2026-05-14 16:43 | Najeeha Tahir | The Mejor Communications | MANUAL | Robert Canfield | 2317255718 | 117,000 | NULL |
| fc02fd61-8551-4010-81c6-0f8667eda8a0 | 2026-05-06 16:01 | Kashif Saleem | Wavetech Infomatics | BULK | Linda Durden | 9122932546 | GA | NULL |
| a8082125-c775-45d4-a85f-74cc069c37f4 | 2026-05-08 20:40 | Zaib Un Nisa | Wavetech Infomatics | BULK | Gene Dankenbring | 5303205802 | - | NULL |
| f2004fea-c736-4c35-8c02-520d8c67ec32 | 2026-05-06 22:20 | John Abraham | Wavetech Infomatics | BULK | Katherine Curl | 8042198486 | - | NULL |
| 54c7852a-4703-4e5a-82c4-53f2a362108d | 2026-05-08 16:21 | Muhammad Taha | EasyTech Communications | BULK | Mark Ruiz | 2103478925 | - | NULL |
| d9badedf-0b35-41b3-9854-20c2d6ddd444 | 2026-05-08 21:02 | Kashif Saleem | Wavetech Infomatics | BULK | Joel Stewart | 4802505864 | - | NULL |
| cfdf7489-1e11-4c54-a891-ab0fa8e7e0f1 | 2026-05-06 16:53 | Waleed Ali | Wavetech Infomatics | BULK | Lakisha Mensah | 8038996555 | - | NULL |
| 6638998d-9f0e-49e3-95a0-86b3b40f0990 | 2026-05-08 20:45 | Sidra Shahbaz | Wavetech Infomatics | BULK | Virgilio Argota | 8086995379 | - | NULL |
| 93ce42e7-5700-4642-be31-2786c33ea6d9 | 2026-05-08 20:45 | Kashif Saleem | Wavetech Infomatics | BULK | Chad Rhone | 8564498239 | - | NULL |
| 76e2a503-b5bd-4a07-be27-5631330eae3c | 2026-05-08 17:54 | Muhammad Bilal | Wavetech Infomatics | BULK | Jayeshkumar Chaudhary | 2293644232 | - | NULL |
| a4e17494-84dd-4265-a57c-0694ad70d07d | 2026-05-06 20:14 | Ali Imran | EasyTech Communications | BULK | Samohaiminul Islam | 2026999384 | - | NULL |
| 1fdc875f-a634-4af5-b4a8-1d01ace5b7e4 | 2026-05-06 16:52 | Ameer Hamza | Wavetech Infomatics | BULK | Elsbeth Foote | 3158716239 | NY | NULL |
| 4b0c48f4-20f4-438e-a141-f171a36f643f | 2026-05-08 18:45 | M. Abu Zar | Wavetech Infomatics | BULK | William Bishop | 7576136298 | - | NULL |
| 8f42d4c4-8102-4d96-bc7a-4ec6c30e6982 | 2026-05-06 17:10 | Farrukh Saleem | Wavetech Infomatics | BULK | James Coleman | 5082090763 | MA | NULL |
| efb0867f-499c-44bb-ae98-e5a0b31880c7 | 2026-05-06 18:19 | Laiba Khan | Wavetech Infomatics | BULK | Jerry Trent | 5202973652 | AZ | NULL |
| c16d0fce-e315-4324-9422-4eeefaceb3fb | 2026-05-06 18:19 | Daud Rehman | Wavetech Infomatics | BULK | Varughese Kuriakose | 9367076887 | - | NULL |
| 68b9bf56-e4a0-4ddb-8ffd-f8209e4842a1 | 2026-05-04 16:40 | Sidra Shahbaz | Wavetech Infomatics | BULK | Eleanor Caminata | 8479771934 | - | NULL |
| dabe27ca-0c6d-4b57-92c0-c43370ad4052 | 2026-05-04 17:19 | Raheel Samson | Wavetech Infomatics | BULK | Kimberly Early | 4792358803 | - | NULL |
| df56a55a-7041-4a7b-90e3-6437816b0fa2 | 2026-05-04 17:23 | Qasim Suleman | Wavetech Infomatics | BULK | Betty Campbell | 3375267618 | - | NULL |
| abd2fdc2-759f-4fae-9afd-676fd0acc6f7 | 2026-05-04 17:44 | Touseef Ahmad | Wavetech Infomatics | BULK | Lynn Newton | 4326383224 | - | NULL |
| 10fcaace-3e95-4b3a-ab77-17426772c7dd | 2026-05-04 17:46 | Fatima Wajid | Wavetech Infomatics | BULK | Willie Dunston | 3472761688 | - | NULL |
| ef40368f-71b7-4b43-b132-39c589c51ba0 | 2026-05-04 17:51 | Junaid Umer Daraz | Wavetech Infomatics | BULK | John Trease | 8017256318 | - | NULL |
| f4240cb6-fc8d-40d1-b9ef-00e44ff1852e | 2026-05-04 17:57 | Kashif Saleem | Wavetech Infomatics | BULK | Peter Null | 3522506450 | - | NULL |
| 27f60707-9478-4812-b1e6-437dd45c6103 | 2026-05-04 18:10 | M Rizwan | Wavetech Infomatics | BULK | Carol Williams | 3163398223 | - | NULL |
| af16997a-3ed9-4030-86b3-53ed01d65a22 | 2026-05-04 18:11 | Fiza Aslam | Wavetech Infomatics | BULK | Mark Demers Demers | 5016723089 | - | NULL |
| ef812027-d7de-480a-844c-183fd20fceda | 2026-05-04 18:15 | Ameer Hamza | Wavetech Infomatics | BULK | Cecelia Ford | 4344854106 | - | NULL |
| daeefead-a077-444f-b02b-435ffae6fb56 | 2026-05-04 18:18 | Waleed Ali | Wavetech Infomatics | BULK | Kathy Neville | 4066713636 | - | NULL |
| f60b1ed1-0af9-40a8-affb-0a32f369ad99 | 2026-05-04 18:23 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Carl Blais | 4184692121 | - | NULL |
| c4886378-2197-47bf-84e2-f570ab2e7366 | 2026-05-04 18:24 | Fatima Wajid | Wavetech Infomatics | BULK | Hemant Patharkar | 3364376512 | - | NULL |
| cfdd02cc-b35f-48ed-89a1-84789aa21b48 | 2026-05-04 18:25 | M. Haris Zahid | Wavetech Infomatics | BULK | Danial Wellington | 3039124774 | - | NULL |
| a622ca40-423c-4f12-954b-e817d88636ec | 2026-05-04 18:26 | Raheel Samson | Wavetech Infomatics | BULK | Karen Hodge | 5046552880 | - | NULL |
| 20598598-8720-4385-a6c0-e73eda54c14a | 2026-05-04 18:28 | Sidra Shahbaz | Wavetech Infomatics | BULK | Willie Harvey | 9892521445 | - | NULL |
| 0c778bdb-9d20-435a-96aa-232ee777be88 | 2026-05-04 18:30 | Salman Amjad | Wavetech Infomatics | BULK | Christopher Brooks | 5165574755 | - | NULL |
| 5e1cab43-b7f8-41b7-94cf-c19fe7c564ca | 2026-05-04 18:44 | Fiza Aslam | Wavetech Infomatics | BULK | Carl Woods | 8036510388 | - | NULL |
| dbc92e20-04ec-4534-b93d-26d6754f671f | 2026-05-04 18:45 | Raheel Samson | Wavetech Infomatics | BULK | Sherri Rice | 2146422725 | - | NULL |
| 4fd3d456-32ac-4063-ad41-823c70739022 | 2026-05-04 20:04 | Fiza Aslam | Wavetech Infomatics | BULK | Mike Kumpe | 8068317256 | - | NULL |
| 50f70ed9-f6f4-4564-b90f-eeaefb01d595 | 2026-05-04 20:06 | Qasim Suleman | Wavetech Infomatics | BULK | David Fernandez | 7578948716 | - | NULL |
| 390bc515-a86f-49f5-821a-96bbe5efe178 | 2026-05-04 20:09 | Muhammad Ahmad | Wavetech Infomatics | BULK | Craig Simon | 5124230113 | - | NULL |
| 5809fa2a-73d5-4dda-bd8c-dae7781977a8 | 2026-05-04 20:10 | Ameer Hamza | Wavetech Infomatics | BULK | Jorge Cedeno | 6292175216 | - | NULL |
| b9913f56-c994-42ef-9f58-1e0f51562efd | 2026-05-04 20:14 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Deborah Mims | 2514426840 | - | NULL |
| 903fd4e8-6460-40a6-88e1-42f0bdcad600 | 2026-05-04 20:14 | Waleed Ali | Wavetech Infomatics | BULK | Richard Easterberg | 7063180944 | - | NULL |
| 266d7a82-7cf0-48b1-bf16-0bfba299d63d | 2026-05-04 20:14 | M Rizwan | Wavetech Infomatics | BULK | Michael Macready | 2525310380 | - | NULL |
| 62652992-5270-47eb-88eb-101cdc9957b0 | 2026-05-04 20:15 | Salman Amjad | Wavetech Infomatics | BULK | Kevin Rokusek | 6059408750 | - | NULL |
| 8d95387c-f4d8-4981-a69a-030cceb72e01 | 2026-05-04 20:28 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Bob Bob | 9176995787 | - | NULL |
| 4f628310-dd70-4a60-8cd3-14f272d5150c | 2026-05-04 20:30 | Kashif Saleem | Wavetech Infomatics | BULK | John Rodrigue | 9852783040 | - | NULL |
| 36a9badd-6929-4e42-bacb-92104883669f | 2026-05-04 20:34 | M. Abu Zar | Wavetech Infomatics | BULK | Kaushal Narke | 5189615771 | - | NULL |
| 7faed543-aa62-42c8-b4ac-8bb87a66abab | 2026-05-04 20:38 | Raheel Samson | Wavetech Infomatics | BULK | June Evans | 7708235650 | - | NULL |
| 63a16601-d9e1-4a07-bf4e-46e1e9e3a646 | 2026-05-04 20:48 | Ameer Hamza | Wavetech Infomatics | BULK | Perry Pharaohs | 3182050974 | - | NULL |
| 2124a4db-4ef3-47e8-a962-e2ce2020ae94 | 2026-05-04 20:49 | Zaib Un Nisa | Wavetech Infomatics | BULK | Leonard Chumsky | 8452160582 | - | NULL |
| 5cc538f1-9254-4558-bf99-a0f30ad1f023 | 2026-05-04 20:49 | Malahim Babar | Wavetech Infomatics | BULK | Donna Reynolds | 6187923236 | - | NULL |
| e09bd652-92d9-491c-87bc-6130b266596f | 2026-05-04 20:53 | Muhammad Bilal | Wavetech Infomatics | BULK | Paul Pfeifer | 2179727285 | - | NULL |
| 4b0e8c7d-913a-4a95-a7d6-52e9bdcc44bd | 2026-05-04 20:55 | Muhammad Ahmad | Wavetech Infomatics | BULK | Patricio Martinez | 2109753274 | - | NULL |
| 4416ed7d-ed6d-44bb-95be-32846b5fcb2e | 2026-05-04 20:58 | M Rizwan | Wavetech Infomatics | BULK | Colleen Leary | 8638525765 | - | NULL |
| 6f908b96-237a-4333-a35a-4189c68a6a9b | 2026-05-04 20:59 | Qasim Suleman | Wavetech Infomatics | BULK | Keith James | 5156391167 | - | NULL |
| 0215ef79-2b4a-449a-9cab-518f5f2b2d59 | 2026-05-04 21:03 | Malahim Babar | Wavetech Infomatics | BULK | Ginger Cintyre | 7166409238 | - | NULL |
| 05206f14-8c0a-4eaf-acde-0190e614c9c3 | 2026-05-04 21:21 | Raheel Samson | Wavetech Infomatics | BULK | Donald Peterson | 5209759226 | - | NULL |
| 3109675b-1d6a-4b83-a9d4-b6c1516f891a | 2026-05-04 21:21 | Kashif Saleem | Wavetech Infomatics | BULK | Barbara Cerf | 9143256534 | - | NULL |
| c4be03a0-00d0-4b63-8b13-6e52fb3c398d | 2026-05-04 21:21 | Ameer Hamza | Wavetech Infomatics | BULK | Donald Christie | 6129166261 | - | NULL |
| 7aec19fe-b550-4146-a522-ef3b035dae9e | 2026-05-04 21:25 | Raheel Samson | Wavetech Infomatics | BULK | Mary Isler | 2523610086 | - | NULL |
| 9e13ea5a-ecc4-498c-a36f-6c4027b020fa | 2026-05-04 21:28 | John Abraham | Wavetech Infomatics | BULK | Ronaldl Smith | 4097188233 | - | NULL |
| 3b91ec4f-976f-4663-ab25-8d31a95be304 | 2026-05-04 21:29 | M Noman | Wavetech Infomatics | BULK | Leonard Dangelo-brun | 6318305336 | - | NULL |
| 61a8bbb1-e787-4761-a42e-10019a02ebd1 | 2026-05-08 21:07 | M Noman | Wavetech Infomatics | BULK | Gilberto Ramos | 8159558967 | - | NULL |
| 84aa549a-a068-429c-8b24-dff51a508e94 | 2026-05-08 21:09 | Touseef Ahmad | Wavetech Infomatics | BULK | Robert Sanford | 8476750341 | - | NULL |
| 9f1c3c8c-60c7-41f2-b6b9-4146a37c3500 | 2026-05-08 21:11 | Sidra Shahbaz | Wavetech Infomatics | BULK | Elouise Brown | 3862094583 | - | NULL |
| 9567121a-a2ac-4e32-b903-69ec5787afcb | 2026-05-08 21:15 | Laiba Khan | Wavetech Infomatics | BULK | Hannah Pepin | 8159220040 | - | NULL |
| 719821ff-b7f3-4bf4-b916-c2e7e53c2d2f | 2026-05-08 21:24 | Qasim Suleman | Wavetech Infomatics | BULK | Stuart Kalstein | 3219146133 | - | NULL |
| 64b29bb1-a745-49d9-9a6c-17c1812f8af4 | 2026-05-08 21:26 | M Rizwan | Wavetech Infomatics | BULK | Francisco Silva | 4074287283 | - | NULL |
| 522d5a4b-99ba-4e64-b537-ca82ec04c3a1 | 2026-05-08 21:30 | M. Haris Zahid | Wavetech Infomatics | BULK | Lisa Alollo | 7249310101 | - | NULL |
| 3ae31d9e-e23a-492c-9875-492291490453 | 2026-05-08 21:31 | M Mohsin | Wavetech Infomatics | BULK | Helen A Krakow | 8014287428 | - | NULL |
| e017771a-2352-4a26-affa-c58a186e7ffa | 2026-05-08 21:39 | Qasim Suleman | Wavetech Infomatics | BULK | Harold Scarlett | 9738681933 | - | NULL |
| 02b2ab20-b9f5-4c68-b7f9-4343f2fc0617 | 2026-05-08 21:46 | Muhammad Bilal | Wavetech Infomatics | BULK | Larry Rutt | 3088744107 | - | NULL |
| 26a460ce-8bbc-4b8f-ab82-53eedf5fd424 | 2026-05-08 21:49 | Qasim Suleman | Wavetech Infomatics | BULK | June Mcrae | 6466423684 | - | NULL |
| b52afead-8cbe-4d3e-83c1-8e49bd157ab2 | 2026-05-08 21:50 | Fiza Aslam | Wavetech Infomatics | BULK | Howard Kelley | 2602210039 | - | NULL |
| 040f2f26-e01a-4772-800d-d4d04608202b | 2026-05-08 21:52 | Ameer Hamza | Wavetech Infomatics | BULK | Jeffrey R Jones | 8018668572 | - | NULL |
| ebec6606-ee82-4763-92ad-1b3457f60c69 | 2026-05-08 21:54 | Kashif Saleem | Wavetech Infomatics | BULK | Donald Voyle | 8603241957 | - | NULL |
| 3dfe99fc-68b8-44f0-8a8f-6d1d7cf11cd8 | 2026-05-08 22:06 | Ameer Hamza | Wavetech Infomatics | BULK | Bernard Powell | 7088183894 | - | NULL |
| a4d6fb95-2747-438f-8dff-605ff074e3b3 | 2026-05-08 20:44 | Mubeen Jabbar | Wavetech Infomatics | BULK | Edward Lindhorn | 9734452751 | - | NULL |
| e85c89af-4990-4abf-bcd0-1cd8c706a15d | 2026-05-01 17:33 | Fatima Wajid | Wavetech Infomatics | BULK | Benjamin Risso | 8632236162 | - | NULL |
| 70d7cff9-2e8a-46d2-8a7e-9c22190c0134 | 2026-05-09 20:51 | Qasim Suleman | Wavetech Infomatics | BULK | Mia Simmons | 4099988993 | - | NULL |
| 23bef31c-0c64-4892-9ba2-b8eac8f07b48 | 2026-05-09 20:47 | Fiza Aslam | Wavetech Infomatics | BULK | Clarence Linton | 9892872076 | - | NULL |
| 39db576c-afdb-45b8-bcd3-8407b5248e32 | 2026-05-09 20:48 | M. Abu Zar | Wavetech Infomatics | BULK | Doris Wolff | 2485450563 | - | NULL |
| c0ad5bd6-88dd-4769-8049-0ec199404dde | 2026-05-09 20:54 | Zaib Un Nisa | Wavetech Infomatics | BULK | Mohammad Baker | 4047022232 | - | NULL |
| df618043-5a3e-418f-b917-f7861b948264 | 2026-05-09 21:01 | Fiza Aslam | Wavetech Infomatics | BULK | Curtis Dance | 2523396907 | - | NULL |
| d96eafb2-8733-497d-9bf9-bff3df94970b | 2026-05-09 21:03 | Laiba Khan | Wavetech Infomatics | BULK | John Evans | 8033471338 | - | NULL |
| 4c206734-aa5e-4c49-bf6d-8426eda3161f | 2026-05-09 21:12 | M. Haris Zahid | Wavetech Infomatics | BULK | Keven Dorce | 6463778199 | - | NULL |
| 45b4d903-f471-4c67-857a-cdeb890304d3 | 2026-05-09 21:36 | Fiza Aslam | Wavetech Infomatics | BULK | Peter Bonfiglio | 8083788837 | - | NULL |
| fa6a3dae-cb2f-4fcd-b31f-739e94e1c344 | 2026-05-09 21:49 | Mubeen Jabbar | Wavetech Infomatics | BULK | Carl Ivy | 9034777003 | - | NULL |
| b18f04f8-477b-4565-8ab3-6783aab61cf4 | 2026-05-09 21:52 | Laiba Khan | Wavetech Infomatics | BULK | Juprina Nathan | 9017070541 | - | NULL |
| 1bdca7b8-60fa-4577-9ea7-1d106f89133c | 2026-05-09 22:29 | M. Haris Zahid | Wavetech Infomatics | BULK | Dorothy Levi | 7733799980 | - | NULL |
| f5eb7698-94d4-4f38-969d-d97f81660e77 | 2026-05-09 22:53 | M. Abu Zar | Wavetech Infomatics | BULK | Oneil Chambers | 2817900121 | - | NULL |
| b4a6b110-b495-4935-9679-557f0b1c9565 | 2026-05-09 22:54 | Rehan Shah | Wavetech Infomatics | BULK | Judy Dias | 6155572426 | - | NULL |
| b342b12b-7a52-4b20-98a9-9fbc3d5d511b | 2026-05-09 23:18 | Zaib Un Nisa | Wavetech Infomatics | BULK | Jacqueline Sanchez | 9176736449 | - | NULL |
| d891011d-3374-48d6-80a4-73593209a393 | 2026-05-09 23:26 | Mubeen Jabbar | Wavetech Infomatics | BULK | Tristan Montgomery | 8016432804 | - | NULL |
| e3965b2f-6108-4837-8354-c8f39effecf4 | 2026-05-09 23:31 | Laiba Khan | Wavetech Infomatics | BULK | David Johnson | 5174042202 | - | NULL |
| 8ee5ce6a-021c-4073-bbe4-41408cd25eb6 | 2026-05-09 23:39 | M. Abu Zar | Wavetech Infomatics | BULK | Luis Soto | 5702128518 | - | NULL |
| 0ee2efed-aa33-4eba-a52e-a5e8d216a313 | 2026-05-09 23:49 | Qasim Suleman | Wavetech Infomatics | BULK | Mahesh Bhatt | 5109284145 | - | NULL |
| 46a007cb-8a8d-4f82-97ef-04c729bb6df2 | 2026-05-09 22:07 | Fiza Aslam | Wavetech Infomatics | BULK | Juron Maconsr. | 3184015519 | - | NULL |
| 5dd178b7-1bbd-41fe-9066-18785d22d4e9 | 2026-05-11 18:52 | John Abraham | Wavetech Infomatics | BULK | Thomas Rosengren | 6269916470 | - | NULL |
| 5d888e49-defa-4f79-868f-1997cbe3f709 | 2026-05-11 20:36 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Luis Madueno | 8457064523 | - | NULL |
| 2e15a13f-04ed-46b4-87ce-12d1bed4cf84 | 2026-05-11 20:43 | Danish Waris | Wavetech Infomatics | BULK | Doris Marks | 8479658363 | 60714-2127 | NULL |
| 162005df-6db4-4628-9896-816ec9aff110 | 2026-05-11 20:46 | Kashif Saleem | Wavetech Infomatics | BULK | Kenneth Amell | 9415388179 | - | NULL |
| 3fea5413-54d6-4f74-8aa1-23cb667e0905 | 2026-05-11 20:51 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Herity Peay | 8036694592 | - | NULL |
| d93667ff-94ae-485e-8531-8978509db932 | 2026-05-11 20:54 | M. Haris Zahid | Wavetech Infomatics | BULK | Samuel Gibbs | 4097815650 | - | NULL |
| 8564b937-b40e-4848-a937-078b30678b55 | 2026-05-11 20:56 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Dorothy Spears | 9317093977 | - | NULL |
| 82f1d539-ac4e-4852-ab67-6441e3128d34 | 2026-05-11 20:58 | Kashif Saleem | Wavetech Infomatics | BULK | Jimmie Proveaux | 3365982765 | - | NULL |
| a228e505-f451-42d0-87ee-098f6d1495c9 | 2026-05-11 21:17 | Salman Amjad | Wavetech Infomatics | BULK | Jane Jones | 8508385657 | - | NULL |
| 64b425a3-ad2f-4980-858b-6838d4a644ed | 2026-05-11 21:22 | Rehan Shah | Wavetech Infomatics | BULK | Greg Jones | 5125921105 | - | NULL |
| ed53526d-7671-44b0-9462-7d37eff4d9f1 | 2026-05-11 21:33 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Miguel Alvarez | 9194511804 | - | NULL |
| da7fa2c8-06f3-48cd-8b97-e1b833a59912 | 2026-05-11 22:02 | Waleed Ali | Wavetech Infomatics | BULK | Michelle Dupree | 5107591045 | - | NULL |
| 8ef8fe5b-7a86-45ae-b43f-20af3e453949 | 2026-05-05 04:00 | Muhammad Fraz Aslam | The Mejor Communications | BULK | Raylene Zbranchik | 8105809654 | 34221-2026 | NULL |
| ac09a790-f172-49b7-8646-87a256da36be | 2026-05-02 20:23 | Laiba Khan | Wavetech Infomatics | BULK | Albert Berliner | 3526338755 | FL | NULL |
| 00171909-99ea-44ce-b9e0-c88aa8fef390 | 2026-05-02 20:57 | Zaib Un Nisa | Wavetech Infomatics | BULK | Albert Ouellette | 8603341203 | CT | NULL |
| 74b10426-b966-45fd-aa8b-55fe18dc1718 | 2026-05-02 21:34 | Muhammad Ahmad | Wavetech Infomatics | BULK | Gerald Chapman | 4805980456 | AZ | NULL |
| 95239c6b-0a3e-493d-b17c-4f7a8f5105e3 | 2026-05-02 22:54 | Ameer Hamza | Wavetech Infomatics | BULK | Mary Tamboli | 3147576903 | FL | NULL |
| 5f2ac3c2-cf44-42ad-8d06-0b8fe346ffc2 | 2026-05-02 23:28 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Wilbert Hunter | 2528832199 | NC | NULL |
| b576421c-4007-486c-a113-c95767cc267b | 2026-05-04 15:43 | Qasim Suleman | Wavetech Infomatics | BULK | Chester Price | 7138581165 | TX | NULL |
| f605174d-2632-48ec-b520-968c361e4893 | 2026-05-04 16:57 | M Rizwan | Wavetech Infomatics | BULK | Skylar / Karla Jones | 6628207191 | - | NULL |
| 5193b073-f041-43ec-9a9a-2d51fd5df0aa | 2026-05-04 16:57 | M Noman | Wavetech Infomatics | BULK | Robert Miller | 5169025303 | - | NULL |
| 2883e4cd-baa2-4da0-9167-32abe4873718 | 2026-05-04 16:59 | Zaib Un Nisa | Wavetech Infomatics | BULK | Elvis Pepushaj | 3475998336 | - | NULL |
| bc04ae58-8036-4afd-a533-c9db0889e53e | 2026-05-19 17:43 | Ahsan Ali | The Mejor Communications | MANUAL | Angela Maalouf | 2035029722 | OOOOO | NULL |
| a45de6c0-f2d9-4cfc-9d97-5d6c2f4d399b | 2026-05-04 17:29 | Zaib Un Nisa | Wavetech Infomatics | BULK | Carol Alquist | 7704909156 | - | NULL |
| ca913687-2a56-4235-bc25-20df7f493a25 | 2026-05-04 17:39 | Malahim Babar | Wavetech Infomatics | BULK | Christina Henry | 9373971793 | - | NULL |
| 0070fd3a-6699-4b8c-b506-eef3d8b98a65 | 2026-05-07 20:26 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Linda Ryan | 4136577713 | MA | NULL |
| f8dfbf25-0087-4130-abd7-c492dd387b03 | 2026-05-04 18:37 | M Rizwan | Wavetech Infomatics | BULK | Tammy Smith | 4439098364 | - | NULL |
| 41eaf9b5-aa49-4dce-984c-0267047f2633 | 2026-05-04 18:37 | M. Haris Zahid | Wavetech Infomatics | BULK | Linda Mitchell | 7314131612 | - | NULL |
| b47edbc9-2a9a-4238-a058-6b5ad9ddb85d | 2026-05-04 18:44 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Stephen Johnson | 7192987160 | - | NULL |
| d801e147-0166-400d-a695-6b4dc211d136 | 2026-05-04 18:45 | Muhammad Ahmad | Wavetech Infomatics | BULK | Gary Mazurkowitz | 3154152300 | - | NULL |
| d6ad692a-4b1e-43c7-a6da-037af4e3ea18 | 2026-05-04 18:45 | Waleed Ali | Wavetech Infomatics | BULK | Walter Towner | 2514062043 | - | NULL |
| 14d06372-f63f-4c2c-96e7-9c72e1c5825a | 2026-05-04 18:56 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Thomas Collinssr | 4433241175 | - | NULL |
| 9f6931ae-ec0a-449c-aba3-07cf29211d81 | 2026-05-04 18:58 | Fiza Aslam | Wavetech Infomatics | BULK | Floyd Mccoy | 8087783175 | - | NULL |
| 66deee91-b425-485e-9091-7385429f7c54 | 2026-05-04 20:28 | Ameer Hamza | Wavetech Infomatics | BULK | Gailen Misek | 7856783026 | - | NULL |
| 8f876a14-d6f5-49e0-bcac-45479b21ba74 | 2026-05-04 20:39 | John Abraham | Wavetech Infomatics | BULK | Kazmi Antoine | 5049123070 | - | NULL |
| 2ce1167e-e780-421e-8b4d-1b9b558916a8 | 2026-05-04 20:54 | Sidra Shahbaz | Wavetech Infomatics | BULK | Larrygardner Owner | 6236887812 | - | NULL |
| d2f49972-177d-4f59-b180-dc78bfec7f33 | 2026-05-04 21:14 | Sidra Shahbaz | Wavetech Infomatics | BULK | Kenneth Laing | 3055427952 | - | NULL |
| c25a2b9d-b705-4e8f-b6e2-9a336d936cbc | 2026-05-04 21:18 | John Abraham | Wavetech Infomatics | BULK | Deborah Nadeau | 2075787307 | - | NULL |
| 6e9d9408-de40-438d-b116-1f4a82e27464 | 2026-05-04 21:19 | M. Abu Zar | Wavetech Infomatics | BULK | Maraa. Hoffman | 5053796100 | - | NULL |
| 5ad98008-8131-432d-b5cf-90400c08c752 | 2026-05-04 21:36 | Mubeen Jabbar | Wavetech Infomatics | BULK | Maynard Hofmeyer | 7126352320 | - | NULL |
| 4376920f-82b6-4599-b157-97b1b46abce8 | 2026-05-04 21:43 | M Rizwan | Wavetech Infomatics | BULK | Emad Khwaja | 6309430063 | - | NULL |
| 7fcaa87a-1ff1-48af-bc3b-7b52fcf9e5bd | 2026-05-04 21:51 | M Mohsin | Wavetech Infomatics | BULK | Mrs Mrs | 4234249318 | - | NULL |
| 90564b0a-0e0a-4c35-b7a3-6ab59af8c8cb | 2026-05-12 22:51 | Sidra Shahbaz | Wavetech Infomatics | BULK | Roland Kearley | 7277262270 | 33763-2968 | NULL |
| ba9c1fd5-3236-49a8-b8c2-fa9e36d2227a | 2026-05-12 23:42 | Zaib Un Nisa | Wavetech Infomatics | BULK | Michel Campeano | 4075050853 | - | NULL |
| 08627f13-ae33-4f77-8635-5999226b0333 | 2026-05-13 17:39 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | William Atkins | 6033321403 | 03868-5704 | NULL |
| a74ca2c9-e4f6-4a9d-b830-be24da3f1e1b | 2026-05-04 16:14 | Muhammad Taha | EasyTech Communications | BULK | Issacc Wittcop | 4239633285 | - | NULL |
| f5af9ea2-ea0f-47cf-a16c-1c95f52a820f | 2026-05-13 22:37 | Muhammad Ahmad | Wavetech Infomatics | BULK | Mary Laudermilk | 2542857535 | - | NULL |
| 80bcb47e-e027-41dd-b621-a4c53ca681e8 | 2026-05-13 22:53 | Qasim Suleman | Wavetech Infomatics | BULK | Deval Millersr | 8038690112 | - | NULL |
| 78fcd94a-d481-4492-8356-b096cc50d746 | 2026-05-13 23:05 | Ameer Hamza | Wavetech Infomatics | BULK | Reggied Isidore | 8328692262 | - | NULL |
| 35d075d0-dbad-42c4-9bdd-0d3d31f11da1 | 2026-05-15 23:11 | M. Abu Zar | Wavetech Infomatics | BULK | Shaun Farrow | 4075956708 | - | NULL |
| 34e1a7fb-efc9-40cc-bd05-a24a592cc309 | 2026-05-08 17:00 | Muhammad Taha | EasyTech Communications | BULK | Lonnie Horne | 7276882906 | - | NULL |
| 5e8dc50e-0d2c-4fa9-9ff0-e5dfbe6c271e | 2026-05-06 21:26 | Muhammad Taha | EasyTech Communications | BULK | Michael Gibson | 8025988561 | - | NULL |
| 00f7f45e-f027-4899-8d0e-3c9cf1af57a2 | 2026-05-02 16:11 | Muhammad Taha | EasyTech Communications | BULK | Earl Lyons | 7068317114 | - | NULL |
| 42623752-2a53-406f-9c43-fbdc39baa7d0 | 2026-05-04 21:15 | Qasim Suleman | Wavetech Infomatics | BULK | Kathy Neville | 4066713636 | - | NULL |
| 0dafdb20-cbc4-4f62-a245-5a22b990fff8 | 2026-05-08 21:30 | John Abraham | Wavetech Infomatics | BULK | Bob Abc | 9176995787 | - | NULL |
| 08597707-847e-4193-a8d2-036647e66faa | 2026-05-11 21:31 | Ameer Hamza | Wavetech Infomatics | BULK | Mike Kumpe | 8068317256 | - | NULL |
| bfa80615-fe38-4188-bcc2-3d1efbba98e1 | 2026-05-09 18:19 | Kashif Saleem | Wavetech Infomatics | BULK | James Ouellette | 2078683562 | - | NULL |
| ecff2642-cd5e-49e6-aef3-b6367d893f6b | 2026-05-12 22:59 | Noman Ahmad | EasyTech Communications | BULK | Shanaya Alexandre | 3478532015 | - | NULL |
| 091a3705-f361-41e8-bdf7-d0d81276a841 | 2026-05-12 22:19 | Ali Imran | EasyTech Communications | BULK | Travis Piersma | 3157960756 | - | NULL |
| a669e5e7-2d9e-47bc-bdf3-25928ffccdd4 | 2026-05-11 23:14 | Al Riyyan Shahmir | EasyTech Communications | BULK | Nobleene Spencer | 8087992325 | - | NULL |
| 29341c78-d948-4e21-b422-3ea185a79cb6 | 2026-05-12 16:13 | Al Riyyan Shahmir | EasyTech Communications | BULK | Jake Bedard | 9788466027 | - | NULL |
| 033c2fc7-393e-4438-889a-74466e0817a8 | 2026-05-12 21:04 | M. Abdul Qadir | EasyTech Communications | BULK | Mendel Goldshmid | 9176182120 | - | NULL |
| f77f4c17-6f5f-419c-a729-028562608d08 | 2026-05-11 16:10 | Ali Imran | EasyTech Communications | BULK | Helen Tiernan | 4015781066 | - | NULL |
| cec4ba96-456a-4b59-bf9e-17393aed39b0 | 2026-05-12 15:22 | Noman Ahmad | EasyTech Communications | BULK | Ronald Brown | 8139675648 | - | NULL |
| 842dc7ef-d02d-42fc-ac62-225076259ae2 | 2026-05-11 23:21 | M. Mohsin | EasyTech Communications | BULK | Keith Zakshevsky | 6316723098 | - | NULL |
| 1f1bab4c-f67f-45c0-86db-9e33d12f969f | 2026-05-12 18:11 | Ali Shan | EasyTech Communications | BULK | Michael Inverso | 9704131113 | - | NULL |
| 3ed382fb-10f8-4419-b2a8-7d3f940e44b9 | 2026-05-12 18:30 | Ali Imran | EasyTech Communications | BULK | Gladys Montoya | 2084311183 | - | NULL |
| 8e98cc39-4bac-4a9f-bd34-03c9c4571797 | 2026-05-11 23:53 | M. Mohsin | EasyTech Communications | BULK | Dick Griffin | 9184293290 | - | NULL |
| efcbeec6-8bd6-4c5e-9c58-e8cb409b6d96 | 2026-05-11 23:30 | M. Mohsin | EasyTech Communications | BULK | Jimmy Yawn | 6013199727 | - | NULL |
| 4c2b08c6-cf85-4e0e-afc8-f99ffc21a3a3 | 2026-05-12 20:36 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Zachary Bliese | 3203051538 | - | NULL |
| 845b3f45-d0a2-4a06-9e8f-78dc6597e360 | 2026-05-11 17:17 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Sharlene Cole | 8184039019 | - | NULL |
| a3fecc70-e04b-4c15-9856-1fc5ce2e6b1d | 2026-05-08 23:24 | M. Abdul Qadir | EasyTech Communications | BULK | Kevin Cotton | 2298949050 | - | NULL |
| c943e4e4-d2b9-4fd6-9dd9-f51797638259 | 2026-05-08 16:55 | Noman Ahmad | EasyTech Communications | BULK | John Vassar | 5097809755 | - | NULL |
| 1f715fb8-8954-4b32-93af-fc20666c78f2 | 2026-05-08 16:43 | Noman Ahmad | EasyTech Communications | BULK | Angela Berthelot | 7274174242 | - | NULL |
| 199ae7d8-c5e7-4139-9963-825d2d0ab676 | 2026-05-08 16:28 | Syed Haider Abbas | EasyTech Communications | BULK | Robert Maciula | 4057626362 | - | NULL |
| 3aec4af7-c0eb-4039-9499-d98514bfc8c6 | 2026-05-08 16:50 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Donna Garza | 2814509334 | - | NULL |
| 050af55e-8c1e-4ea7-a0e8-320fbcb071e1 | 2026-05-07 16:49 | Arooj Akbar | EasyTech Communications | BULK | Dale Bachman | 6028821617 | - | NULL |
| 296cb610-8d51-4de2-92c9-5513afc3b870 | 2026-05-11 22:42 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Adam Kicilinski | 3475433594 | - | NULL |
| 5557ae37-fb94-4dad-8cc9-1688128aa973 | 2026-05-06 22:21 | M. Abdul Qadir | EasyTech Communications | BULK | Yagna Daggupati | 5852874334 | - | NULL |
| 06e98a91-3081-4de7-b3e7-b185c3d17cb1 | 2026-05-07 16:39 | Rana Muhammad Bilal | EasyTech Communications | BULK | Earl Lee | 8137342687 | - | NULL |
| f2803502-da3f-45d5-bf6b-cfccbb2cefdf | 2026-05-07 16:20 | Ali Shan | EasyTech Communications | BULK | Marvin Godfrey | 8649805561 | - | NULL |
| 3751c598-edfb-401b-a12d-b7441dce69ca | 2026-05-07 16:34 | Al Riyyan Shahmir | EasyTech Communications | BULK | Benjamin Hope | 3052829548 | - | NULL |
| 65c7ab0a-6d32-4721-90ec-4c19852092e8 | 2026-05-07 15:59 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Joseph Newell | 5704171355 | - | NULL |
| be3c9700-994b-454b-8371-b5ffef834b5f | 2026-05-06 21:23 | Syed Haider Abbas | EasyTech Communications | BULK | John Huntington | 5034598829 | - | NULL |
| 3435db95-f46b-49dc-bd11-a3a4a137a89e | 2026-05-04 22:19 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Tavieon Poole | 4347131432 | - | NULL |
| 2140c1fc-a202-4b2c-adda-bec8a015d533 | 2026-05-04 22:27 | Ali Imran | EasyTech Communications | BULK | Anntoniette Johnson | 2055191470 | - | NULL |
| 54b82c7a-a679-4059-8bbd-9b7cf222bae7 | 2026-05-05 17:01 | Ali Shan | EasyTech Communications | BULK | Angel Fannin | 6067944717 | - | NULL |
| 8b5549d2-4ec7-4992-869d-0d74bb543c89 | 2026-05-04 22:07 | M. Abdul Qadir | EasyTech Communications | BULK | Angel Hale | 4232371180 | - | NULL |
| 4e358c2f-bc20-4a45-8cc7-48e06346bc59 | 2026-05-05 18:26 | Syed Haider Abbas | EasyTech Communications | BULK | Melissa Cote | 6038090899 | - | NULL |
| afa1254d-eed9-41fe-8a25-cc01b548db97 | 2026-05-06 17:47 | M. Abdul Qadir | EasyTech Communications | BULK | Lindsey French | 8652034010 | - | NULL |
| abb8a3c5-ce72-43bd-baa1-4dcc9695f86b | 2026-05-06 17:29 | Syed Haider Abbas | EasyTech Communications | BULK | Zachary Smith | 5018317563 | - | NULL |
| a28a53fe-6e32-4de9-8b49-a3cc80b83269 | 2026-05-06 18:02 | Noman Ahmad | EasyTech Communications | BULK | Marco Amador | 8327887023 | - | NULL |
| 68840b65-d3ca-4b49-b774-a1844c1be21d | 2026-05-06 18:57 | Syed Haider Abbas | EasyTech Communications | BULK | Christie Campbell | 5756260725 | - | NULL |
| f0672f85-0d40-4c22-995d-0a763884cafa | 2026-05-06 18:58 | M. Abdul Qadir | EasyTech Communications | BULK | Timothy Jensen | 3072583025 | - | NULL |
| 54f2ffcf-fcc7-4bdb-87de-867ffb3b1521 | 2026-05-06 22:00 | Kashif Saleem | Wavetech Infomatics | BULK | Juanita Abc | 8302799035 | - | NULL |
| 56839e86-0a3f-4b0a-9ff1-91e2d2b59983 | 2026-05-06 16:39 | Muhammad Umar Mahmood | EasyTech Communications | BULK | David Irving | 2252524888 | - | NULL |
| 44966e4e-2f29-4f02-bc43-6645a8b20519 | 2026-05-06 18:02 | Al Riyyan Shahmir | EasyTech Communications | BULK | Phillip Smith | 9183999262 | - | NULL |
| 28ea7462-e32b-4a82-825e-95c36a01fbb3 | 2026-05-06 16:34 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Randy Roth | 7162581567 | - | NULL |
| 96931f89-a390-48b3-be8c-a773e74794ed | 2026-05-06 16:41 | Arooj Akbar | EasyTech Communications | BULK | Jairius Riddick | 7577385313 | - | NULL |
| 9d1521af-6b14-480d-a160-0ec0281b5502 | 2026-05-06 16:35 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Matthew Edwards | 6466758945 | - | NULL |
| 126a8c43-2a43-47c8-8fae-084cc5a46121 | 2026-05-04 15:59 | Rana Muhammad Bilal | EasyTech Communications | BULK | Joannex Jones | 3053320368 | - | NULL |
| 83950338-f588-4f33-b1bf-861036a88c68 | 2026-05-04 15:58 | M. Iman Suleman | EasyTech Communications | BULK | Dean Kirschbaum | 5153931529 | - | NULL |
| 266ee774-1a72-42c9-875b-879edc2698f9 | 2026-05-04 17:58 | Al Riyyan Shahmir | EasyTech Communications | BULK | Jennice Beatty | 3199614962 | - | NULL |
| 9f939d58-9138-4e8f-9c38-138f0f00c5a0 | 2026-05-04 16:39 | M. Iman Suleman | EasyTech Communications | BULK | Dimitry Pesdun | 6053519340 | - | NULL |
| 2fdab482-89a9-42e3-86d3-ba1f88d15e8b | 2026-05-04 16:23 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Jon Rodriguez | 3614132079 | - | NULL |
| 93975f11-4a3c-49e2-a72a-d7ba51691a95 | 2026-05-04 16:25 | Al Riyyan Shahmir | EasyTech Communications | BULK | Jeff Slemons | 3026821816 | - | NULL |
| 05773a6e-fe01-4e26-96aa-cb5b1520c66e | 2026-05-11 16:14 | Huzaifa Shafiq | EasyTech Communications | BULK | Noberta Rowe | 8082370073 | - | NULL |
| 308da436-e5ad-4e68-8023-90761500ac2b | 2026-05-04 16:13 | Ali Shan | EasyTech Communications | BULK | Brian Schreifels | 6232037489 | - | NULL |
| 472efc06-be00-4933-8fdc-ef7b72be2747 | 2026-05-04 15:51 | Arooj Akbar | EasyTech Communications | BULK | Barbara Brown | 2032199404 | - | NULL |
| 351ec91e-987e-422d-a0e7-567c835473f0 | 2026-05-04 17:49 | Rana Muhammad Bilal | EasyTech Communications | BULK | Freydel Rodriguezcaro | 6462269442 | - | NULL |
| a439262e-0113-43b5-a4c3-7e911e1cacba | 2026-05-04 16:10 | Arooj Akbar | EasyTech Communications | BULK | Michael Laisure | 2168709036 | - | NULL |
| 971ae5db-f6f0-4c17-947a-1276ece519bc | 2026-05-04 15:53 | Al Riyyan Shahmir | EasyTech Communications | BULK | Valentina Scarlett | 7162891009 | - | NULL |
| d80159bb-95fe-4901-bf20-be005013227a | 2026-05-04 15:51 | M. Iman Suleman | EasyTech Communications | BULK | Deanna Marshall | 6315729340 | - | NULL |
| 5121e939-5731-4482-996a-e1a68b9d539d | 2026-05-04 17:55 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Rashad Byers | 4349890197 | - | NULL |
| 42c9fced-72dc-4d3b-9da6-04a0c8d4e33a | 2026-05-02 17:33 | Huzaifa Shafiq | EasyTech Communications | BULK | Lisa Brunson | 5616741935 | - | NULL |
| 946d0cf9-48c8-468d-8bb6-55a7e8f91876 | 2026-05-02 15:23 | M. Abdul Qadir | EasyTech Communications | BULK | Mattison Barker | 9792132555 | - | NULL |
| bcad9998-d79f-4200-8e1d-c623591665d5 | 2026-05-04 23:32 | Ali Shan | EasyTech Communications | BULK | Clayton Hamel | 4056845663 | - | NULL |
| 007c591e-9c24-4bed-bf57-15ec8182ec0b | 2026-05-12 20:19 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Larry Douglas | 2566792101 | - | NULL |
| 4a36598f-b66b-4bab-bbc8-8ce776144695 | 2026-05-02 18:06 | Noman Ahmad | EasyTech Communications | BULK | Rebecca Panter | 7065707295 | - | NULL |
| 57d4037b-aae8-41af-9dc5-300eaec5258e | 2026-05-02 17:34 | Hanan Arif | EasyTech Communications | BULK | Julie Rathbun | 6025685024 | - | NULL |
| 6f567362-6212-4c18-bc43-38820e3fe36a | 2026-05-02 15:55 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Alvin Schumacher | 3076313229 | - | NULL |
| 454c88b1-62cc-4c7b-8069-1f20e654ea4a | 2026-05-02 15:37 | M. Iman Suleman | EasyTech Communications | BULK | Raymond Padilla | 9098383963 | - | NULL |
| 5d44e56d-cc27-4b45-bf33-817907cee8dc | 2026-05-01 23:03 | M. Mohsin | EasyTech Communications | BULK | Pattye Depue | 5154804367 | - | NULL |
| b647aad9-a93f-4068-b012-91b816f61b6c | 2026-05-01 22:32 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Raymund Otrigo | 8326541659 | - | NULL |
| 5fda29e5-eb6e-450a-a85a-dc0b03607d5b | 2026-05-01 23:19 | Ali Imran | EasyTech Communications | BULK | Willie Sumlin | 2059605650 | - | NULL |
| 2d7d6c55-ed2b-4561-981e-4cbe68c09d64 | 2026-05-01 21:49 | Arooj Akbar | EasyTech Communications | BULK | Patricia Steffen | 4028419736 | - | NULL |
| c6e5a1fe-6426-4fd2-8e4f-4fdbc382a028 | 2026-05-01 23:06 | Ali Shan | EasyTech Communications | BULK | Francis Lambert | 5185819676 | - | NULL |
| ff5fcb57-ce93-4fc8-a9f3-cb268bef9d93 | 2026-05-01 22:43 | Rana Muhammad Bilal | EasyTech Communications | BULK | Vivek Dahiya | 4088289685 | - | NULL |
| e0e44216-1b49-42f2-8780-e35a297302e3 | 2026-05-01 21:41 | Arooj Akbar | EasyTech Communications | BULK | John Bell Jr. | 9193236839 | - | NULL |
| 5a5b6f01-7f5c-4afd-be35-0308bed69b37 | 2026-05-06 18:03 | Hanan Arif | EasyTech Communications | BULK | Sholem Felberbaum | 8458263107 | - | NULL |
| 6a72aa6e-7303-40d4-9a8e-b520a4e4785e | 2026-05-01 23:06 | Muhammad Umar Mahmood | EasyTech Communications | BULK | Marianna Kuczaj | 6308051128 | - | NULL |
| 801ea8f9-0cf1-4722-9a0c-d10e60364308 | 2026-05-01 21:37 | Ali Shan | EasyTech Communications | BULK | Floyd Baldwin | 8164193883 | - | NULL |
| df416bc7-f101-4650-a4ab-caf455e4adea | 2026-05-01 22:32 | M. Iman Suleman | EasyTech Communications | BULK | Kevin Mcintosh | 9012706073 | - | NULL |
| 8656d5db-33b7-426c-8997-c76b147928c6 | 2026-05-01 22:53 | M. Iman Suleman | EasyTech Communications | BULK | Kay Mcfarland | 2088303233 | - | NULL |
| 11d5dfc9-3011-44ee-b8a4-2cdd8014b8fb | 2026-05-02 20:38 | M. Mohsin | EasyTech Communications | BULK | Patricia Zaves | 5044077808 | - | NULL |
| 280e31ae-5c48-4978-bbec-630cc25904ec | 2026-05-12 04:00 | Taimoor Ahmad | The Mejor Communications | BULK | Audrine Abc | 6025050689 | 363601 | NULL |
| 01c64668-0f1a-4d5c-ae56-c746a901d8a6 | 2026-05-12 04:00 | Taimoor Ahmad | The Mejor Communications | BULK | Jhonson Abc | 4077603821 | 363601 | NULL |
| c8022223-1810-4f24-bafd-2f2a23a7ad3d | 2026-05-01 21:26 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Billy Hanks | 7203669448 | - | NULL |
| db3e9b07-9c56-4aea-b0e2-9c12a5fb9a85 | 2026-05-04 21:27 | M Rizwan | Wavetech Infomatics | BULK | Ronald Powell | 3092214410 | - | NULL |
| 087afe1f-805c-4613-86e0-f098e24d0197 | 2026-05-04 21:50 | Mubeen Jabbar | Wavetech Infomatics | BULK | James Drew | 7063188099 | - | NULL |
| 5c0e0a5b-286c-45bb-94ec-d05774091e0a | 2026-05-04 22:08 | Sidra Shahbaz | Wavetech Infomatics | BULK | Lincoln Freeman | 5419415549 | - | NULL |
| fb17c315-05d4-4312-bf7a-a64f629d57f7 | 2026-05-04 22:23 | Muhammad Ahmad | Wavetech Infomatics | BULK | Linda Braden | 2816852516 | - | NULL |
| 3d249d48-48bc-4c12-a31b-4322ac8c83e7 | 2026-05-04 23:42 | Muhammad Bilal | Wavetech Infomatics | BULK | Susan Shepherd | 9727682109 | - | NULL |
| e7e92211-4da0-429e-b4e6-76b784a483ce | 2026-05-06 22:20 | Tahrim Fatima | Wavetech Infomatics | BULK | Ethan Abbott | 2073432823 | - | NULL |
| 43269d9b-9cf8-4521-bedf-afaf60f1c4b6 | 2026-05-07 23:49 | Qasim Suleman | Wavetech Infomatics | BULK | Janet Serpe | 2394661451 | FL | NULL |
| 17f84eee-a8e0-431b-bb8e-2221cf9724f7 | 2026-05-08 18:28 | Salman Amjad | Wavetech Infomatics | BULK | Gordon Burrill | 7194404572 | - | NULL |
| ebb6a501-4874-4f09-83f7-8c02a745463c | 2026-05-08 22:11 | Ameer Hamza | Wavetech Infomatics | BULK | Suec Lafollette | 5023311163 | - | NULL |
| 39c4fd4b-da97-4431-89e3-3db59f661ba1 | 2026-05-08 22:12 | M Rizwan | Wavetech Infomatics | BULK | Aerial Lowery Lowery | 7042241756 | - | NULL |
| 2207496e-1da3-4a59-9c1a-89217736d6f3 | 2026-05-01 23:35 | M. Iman Suleman | EasyTech Communications | BULK | Dorothy Ristic | 9546297306 | - | NULL |
| 71e47b13-c0b5-4a9c-99e4-cb12106346f0 | 2026-05-01 21:18 | M. Mohsin | EasyTech Communications | BULK | Carol Melton | 9183815697 | - | NULL |
| ca1e9e3e-7f17-4bd1-8688-9ab878207a82 | 2026-05-04 22:05 | M Noman | Wavetech Infomatics | BULK | Lloyd Wilson | 7576152880 | - | NULL |
| b4d1f007-8f30-492f-9798-2f8b5f0e5f67 | 2026-05-04 22:05 | M Mohsin | Wavetech Infomatics | BULK | Yash Reddy | 5017778055 | - | NULL |
| 48e9d88a-5c60-4140-b842-c63ea1229405 | 2026-05-04 22:10 | M. Abu Zar | Wavetech Infomatics | BULK | Vincent Ducre | 9857741081 | - | NULL |
| b14ee875-a20c-4b73-bcdd-d79d0242f6dc | 2026-05-04 22:02 | Malahim Babar | Wavetech Infomatics | BULK | Kevin Weber | 5635999411 | - | NULL |
| 72947f2f-d5dd-48e8-afce-2d3cb96f8bde | 2026-05-08 23:00 | M Rizwan | Wavetech Infomatics | BULK | Don Allison | 4793083982 | AR | NULL |
| 1ceb4ceb-7bf2-442d-aa85-382f227967fe | 2026-05-08 23:07 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | Larry Wippert | 8174488267 | - | NULL |
| 36e629aa-66a2-4220-ac46-8ddbb1738e2f | 2026-05-11 16:40 | Danish Waris | Wavetech Infomatics | BULK | Kevin Cox | 3213544747 | FL | NULL |
| 562e5858-f787-4f1b-8f99-f3de630b6661 | 2026-05-11 17:08 | Mubeen Jabbar | Wavetech Infomatics | BULK | Carolyn Chase | 5413122600 | OR | NULL |
| d31af243-d07b-4265-9b4a-ef256b4686d0 | 2026-05-11 17:34 | Rehan Shah | Wavetech Infomatics | BULK | Fidencio Garcia | 9562466328 | TX | NULL |
| 6933cebd-f3ee-4a35-a3ae-48370c9992a4 | 2026-05-11 18:31 | M. Haris Zahid | Wavetech Infomatics | BULK | Bielman Cinto | 2299212471 | NC | NULL |
| 7f56f78f-c654-4cc4-b40b-f9f20022f21c | 2026-05-12 21:40 | Malahim Babar | Wavetech Infomatics | BULK | Ramesh Abc | 4842205048 | - | NULL |
| 98039b41-4752-46c3-8af4-6ef1f93f4894 | 2026-05-13 20:07 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Serafim Ivask | 5166503078 | - | NULL |
| 9715e72c-747a-492a-8737-be0ba62b7a85 | 2026-05-13 20:19 | Salman Amjad | Wavetech Infomatics | BULK | Lindsay Mcmahan | 8328665115 | TX | NULL |
| 502684a0-12e2-43ef-ad82-756bc6e555e1 | 2026-05-13 21:38 | M Mohsin | Wavetech Infomatics | BULK | Sharon Vetrano | 5614901089 | FL | NULL |
| 01b20303-ac4c-42b6-9dfa-b520b424acf7 | 2026-05-14 15:21 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Guillermo Carrillo | 3179457804 | IN | NULL |
| e3343db2-e6ed-48b0-8e78-14df76b1d76e | 2026-05-14 20:57 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Roberta Hutchinson | 2402454860 | MD | NULL |
| f5c9e00c-659e-4f22-8704-99e3aa256af1 | 2026-05-15 16:10 | Muhammad Moaz Ali | Wavetech Infomatics | BULK | James Muller | 4072305840 | FL | NULL |
| 4b38e663-9b10-41ac-bbc6-6a59b3567a00 | 2026-05-15 17:15 | Qasim Suleman | Wavetech Infomatics | BULK | Jane Farissier | 9734640832 | NJ | NULL |
| a60cbf24-2e24-4557-98bd-9746e6890053 | 2026-05-15 17:26 | M Mohsin | Wavetech Infomatics | BULK | Sandra Brown | 4043761012 | GA | NULL |
| 75c69610-78f3-428e-8daf-fbabd0ca90a7 | 2026-05-15 20:49 | Touseef Ahmad | Wavetech Infomatics | BULK | James Henderson | 8436967741 | SC | NULL |
| eab7aab6-a3d8-48ec-9ff9-13e0e9a0fda7 | 2026-05-15 23:29 | M. Haris Zahid | Wavetech Infomatics | BULK | Susan Charles | 5618175505 | FL | NULL |
| 2de57335-cc28-452b-aa3d-16d769ba5115 | 2026-05-06 17:42 | Mubeen Jabbar | Wavetech Infomatics | BULK | Linda Gates | 7246594182 | PA | NULL |
| 6a889864-2809-4ebb-af4d-eb16ba361902 | 2026-05-06 22:02 | Ameer Hamza | Wavetech Infomatics | BULK | Linda Gates | 7246594182 | PA | NULL |
| a14117f5-71b7-4289-bf35-586a82386383 | 2026-05-06 22:57 | Raheel Samson | Wavetech Infomatics | BULK | Linda Gates | 7246594182 | PA | NULL |
| c61c452c-1450-45ae-86ce-3ee5c1ca8cc9 | 2026-05-07 20:55 | M Rizwan | Wavetech Infomatics | BULK | Elisbeth Foote | 3158716239 | NY | NULL |
| d315f9a8-91ef-43cd-ab2c-0cfbcae853b0 | 2026-05-11 16:42 | M. Faraz Jamil | Wavetech Infomatics | BULK | Ella Mosby | 9013961483 | TN | NULL |
| 9c2d42d5-5eaa-423e-b3c9-0f01f9c1cd14 | 2026-05-11 22:05 | John Abraham | Wavetech Infomatics | BULK | Linda Gates | 7246594182 | PA | NULL |
| f0518697-0166-4b4d-b762-133b4c0198ad | 2026-05-01 17:04 | M. Faraz Jamil | Wavetech Infomatics | BULK | Henry Koenig | 7135828384 | - | NULL |
| 38c4aff2-7c8f-4ada-83af-a29c45487f0c | 2026-05-07 20:38 | Laiba Khan | Wavetech Infomatics | BULK | Delores Setula | 7634776323 | MN | NULL |
| bbd3abc5-7057-4c03-8b44-cffda956c77f | 2026-05-07 21:22 | Sidra Shahbaz | Wavetech Infomatics | BULK | Ella Mosby | 9013961483 | TN | NULL |
| d29f4b6a-d8f1-4deb-bb96-7baaff196506 | 2026-05-08 21:45 | Ali Imran | EasyTech Communications | BULK | Cody White | 7738951311 | - | NULL |
| 18236e3c-35d8-4247-8073-19914508e06a | 2026-05-14 21:42 | M. Mohsin | EasyTech Communications | BULK | David Tucker | 5806991949 | OK | NULL |

---

## 9. Email missing `@` — transfers (110 rows)

Replace with `no@email.com` per request.

| id | created_at | created_by | company | batch | customer | phone | BAD email | replacement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2dff0f99-cc91-4f3b-97b7-8ac78dcb1613 | 2026-05-05 22:59 | Daud Rehman | Wavetech Infomatics | BULK | Ernest Dupuy | 5613769430 | - | no@email.com |
| a2222c26-debd-498b-afc9-c56b2e3051bd | 2026-05-06 20:09 | Farrukh Saleem | Wavetech Infomatics | BULK | David Powell | 9363270850 | - | no@email.com |
| 5fa5faa1-e281-4931-9711-1a6921880270 | 2026-05-06 21:24 | Farrukh Saleem | Wavetech Infomatics | BULK | Kenneth Drakeley | 7863189101 | - | no@email.com |
| 7084a523-cbb0-4faa-bb34-ace7e8381cc1 | 2026-05-07 17:31 | Touseef Ahmad | Wavetech Infomatics | BULK | Robbie Meek | 3187347434 | - | no@email.com |
| 579fa4df-0df5-4021-9957-d7737685996a | 2026-05-07 18:01 | Farrukh Saleem | Wavetech Infomatics | BULK | Linda Jones | 3176401711 | - | no@email.com |
| 4d7de93d-b7f2-4158-8397-98a03e5970f8 | 2026-05-06 04:00 | Daud Rehman | Wavetech Infomatics | BULK | Donald Fitzgerald | 8646178834 | - | no@email.com |
| c0953889-4af6-4bde-8a56-c7a74aa1eada | 2026-05-07 18:20 | Salman Amjad | Wavetech Infomatics | BULK | Sean Hancock | 7274675084 | - | no@email.com |
| 46c98e91-b96b-4989-a9ef-90a1a2466ab0 | 2026-05-07 20:23 | Farrukh Saleem | Wavetech Infomatics | BULK | Carol Orlando | 8179468753 | - | no@email.com |
| b557fc56-9bd0-499c-91ba-e80463fefc4e | 2026-05-08 18:14 | M. Faraz Jamil | Wavetech Infomatics | BULK | Thelma Wenrick | 9856623221 | - | no@email.com |
| 0ed525a4-ca66-47a9-a644-ff116f83eb24 | 2026-05-25 19:44 | Kashif Saleem | Wavetech Infomatics | MANUAL | Paul Brunetti | 9013154406 | - | no@email.com |
| cf2ed7f2-8e73-4e80-8cbe-e9e291f17739 | 2026-05-01 04:00 | Onyx | Onyx | BULK | Marylynn Burroughs | 5408411943 | - | no@email.com |
| 38faa189-263d-4b90-a618-3408204dcc70 | 2026-05-02 04:00 | Jamjon | The Mejor Communications | BULK | Kathleen Raulerson | 9128432446 | - | no@email.com |
| 01eda00d-2b3a-4af0-abe6-b6c1690297cb | 2026-05-01 04:00 | Adil Team | Adil Team | BULK | Grady Brown | 9726397058 | - | no@email.com |
| 329677d5-5200-4e44-bddc-021579be6732 | 2026-05-01 04:00 | Daud Rehman | Wavetech Infomatics | BULK | Sylvia Hylton | 4105127558 | - | no@email.com |
| 5ebd0390-7b95-4652-88f2-3f5bf14e1f8d | 2026-05-01 04:00 | Farrukh Saleem | Wavetech Infomatics | BULK | Linda Gurley | 8502640337 | - | no@email.com |
| a1aec16b-e78c-4b7f-8599-52f79001ac72 | 2026-05-04 04:00 | Adil Team | Adil Team | BULK | Georgia Lawrence | 3345444990 | - | no@email.com |
| d08eb08b-9ea3-4aa3-aeeb-a55f92cd35e1 | 2026-05-04 04:00 | Onyx | Onyx | BULK | Jeffery Ford | 4095480682 | - | no@email.com |
| d7b6de0e-5b83-4a94-9217-053dc065bcf8 | 2026-05-04 04:00 | Touseef Ahmad | Wavetech Infomatics | BULK | Nancy Larock | 9414470006 | - | no@email.com |
| ce6dd132-37bb-4e71-95c0-11e3969a5c1a | 2026-05-08 20:14 | Farrukh Saleem | Wavetech Infomatics | BULK | Lester Goldstein | 8286263935 | - | no@email.com |
| 1a6ab092-612d-478e-96ca-3637cfe694d0 | 2026-05-02 04:00 | Onyx | Onyx | BULK | Gregory Vasser | 4122433576 | - | no@email.com |
| b1d2b25e-2794-4308-a2dc-02ae0c94457c | 2026-05-05 04:00 | Onyx | Onyx | BULK | Wesley Mcmillan | 8063823831 | - | no@email.com |
| 4d73c13c-21ce-41cd-b8bc-572f56b2e57c | 2026-05-05 04:00 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Helen Suazo | 7185242233 | - | no@email.com |
| 98230af8-0a18-4aee-a766-8e0693d22ba6 | 2026-05-04 04:00 | John Abraham | Wavetech Infomatics | BULK | Tina Cherchio | 3154404045 | - | no@email.com |
| 1d587263-b04c-4fc2-92ae-6bb2c6e29d34 | 2026-05-05 04:00 | Fatima Wajid | Wavetech Infomatics | BULK | Euarl Moss | 6014828614 | - | no@email.com |
| 65fff88e-92a7-43b9-9042-1249077b25ef | 2026-05-25 19:09 | M Rizwan | Wavetech Infomatics | MANUAL | Katherine Moore | 6033433123 | - | no@email.com |
| ab8a60e8-9c54-4c71-8f76-3814eba524d3 | 2026-05-05 04:00 | Adil Team | Adil Team | BULK | Gwendolyn Williams | 5044649121 | - | no@email.com |
| 93ba00c5-f305-4036-8726-94b7a17ec00d | 2026-05-06 04:00 | Huzaifa Shafiq | EasyTech Communications | BULK | Donald Nealey | 2812363331 | - | no@email.com |
| f9f25d75-1c6d-44da-916b-2875dfd6ed2f | 2026-05-07 04:00 | Danish Waris | Wavetech Infomatics | BULK | John Thompson | 7186585763 | - | no@email.com |
| c731b93b-7856-4233-a9e1-82fdddf810ea | 2026-05-08 04:00 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Anthony Poole | 3479078820 | - | no@email.com |
| 34f06f82-b962-479d-8a30-5e4eb4eccae2 | 2026-05-09 04:00 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Laquinta Carter-simon | 4095403016 | - | no@email.com |
| 9d241d07-90de-4d9d-bb27-23f4b1baed8d | 2026-05-11 04:00 | M. Abu Zar | Wavetech Infomatics | BULK | Rickey Grixgby | 5033147957 | - | no@email.com |
| 7c3f262b-dc4b-4c6e-b688-4b45419552c2 | 2026-05-09 04:00 | Onyx | Onyx | BULK | Roosevelt Lawson | 8433594394 | - | no@email.com |
| 0001cebd-9150-4500-8547-8cd383045e54 | 2026-05-09 04:00 | Adil Team | Adil Team | BULK | Levota Forrest | 8563453723 | - | no@email.com |
| 69d0dc40-fd7f-47c3-a492-7cb0c49d029f | 2026-05-12 04:00 | Adil Team | Adil Team | BULK | Marion Johnson Jr. | 6788513263 | - | no@email.com |
| 438e978d-e65a-4c39-bb23-c7a14353fce9 | 2026-05-12 04:00 | M. Faraz Jamil | Wavetech Infomatics | BULK | Morris James | 9039751855 | - | no@email.com |
| eba512b6-b384-4343-93ec-a08180b7b713 | 2026-05-12 04:00 | Kashif Saleem | Wavetech Infomatics | BULK | Jose Veliz | 3616764251 | - | no@email.com |
| b08134a8-d26e-427d-9325-b8497cce70bd | 2026-05-13 04:00 | Kashif Saleem | Wavetech Infomatics | BULK | Stepahnie Mayfield | 3522228652 | - | no@email.com |
| 5efc126c-d7cc-4a62-82bb-00df9af75498 | 2026-05-14 04:00 | Wishal Robert | The Mejor Communications | BULK | Laurie Andrews | 4042345969 | - | no@email.com |
| 3d723efe-97aa-4e6a-bb62-9625244c4e90 | 2026-05-15 04:00 | Adil Team | Adil Team | BULK | Michael Zorn | 9794515548 | - | no@email.com |
| af14f797-a0b6-422e-a430-587e4231f98b | 2026-05-18 04:00 | Touseef Ahmad | Wavetech Infomatics | BULK | Marilyn Whitehurst | 5413504992 | - | no@email.com |
| 6a95ae46-7bdf-4723-be32-d58fd3f0ca59 | 2026-05-21 04:00 | Onyx | Onyx | BULK | Lidya Vanbenthuysen | 4077873971 | - | no@email.com |
| d60fa531-24bd-43e8-8a53-c96f6be45f76 | 2026-05-19 04:00 | Haider Waqas Khan | EasyTech Communications | BULK | Michael Mikulka | 8323386589 | - | no@email.com |
| 4d00902d-00c3-4124-8083-31afa1680a61 | 2026-05-19 04:00 | Farrukh Saleem | Wavetech Infomatics | BULK | Shirley Atkisson | 2565891675 | - | no@email.com |
| 1c7af7bf-eb7a-4795-b974-a0cfd6b41d57 | 2026-05-19 04:00 | Qasim Suleman | Wavetech Infomatics | BULK | Patricio Pazmino | 9152025508 | - | no@email.com |
| 8d5ab46a-02c3-4bcd-9f54-0af52de6f966 | 2026-05-19 04:00 | Touseef Ahmad | Wavetech Infomatics | BULK | Judy Daugherty | 2526714572 | - | no@email.com |
| 2e8ba473-bd6d-414e-8f27-3202b426514c | 2026-05-20 04:00 | Onyx | Onyx | BULK | Larry Parks | 6622873605 | - | no@email.com |
| 5ba8dc4b-2a02-4a9a-82e3-a22673405ca9 | 2026-05-21 04:00 | Onyx | Onyx | BULK | Marie Perkins | 6062646962 | - | no@email.com |
| f0c20a01-9fc3-4f16-b8cf-3e6c6ba234b3 | 2026-05-21 04:00 | Tahrim Fatima | Wavetech Infomatics | BULK | Nancy Malcom | 4076444427 | - | no@email.com |
| acaf5a50-deea-471e-956c-1ad428d091e2 | 2026-05-21 04:00 | Junaid Umer Daraz | Wavetech Infomatics | BULK | Shirley Mcknight | 2035276723 | - | no@email.com |
| 7e7bc25b-4429-4531-b4cb-1a44b39da052 | 2026-05-21 04:00 | Onyx | Onyx | BULK | Alvin Eschuchhardt | 7574045052 | - | no@email.com |
| 9c547ea1-67b2-4fe6-b4de-a8e4eed6147e | 2026-05-22 04:00 | Onyx | Onyx | BULK | Ann Megargee | 8504454636 | - | no@email.com |
| be8a0abf-e096-49c2-a2f2-899444c50530 | 2026-05-22 04:00 | Onyx | Onyx | BULK | Linda Adkins | 3166171766 | - | no@email.com |
| e382e5c4-ae45-40be-9f0e-45e99105982f | 2026-05-07 04:00 | Onyx | Onyx | BULK | Dorothy Vandyke | 3863131240 | - | no@email.com |
| e0bef56d-755b-436d-9472-c6be0d81bd23 | 2026-05-08 04:00 | Ali Shan | EasyTech Communications | BULK | Jane Gettier | 7574267964 | - | no@email.com |
| 1ef8aead-603f-4d17-8016-b6648dba7efc | 2026-05-14 04:00 | Waleed Ali | Wavetech Infomatics | BULK | Glenn Stacks | 5015145006 | - | no@email.com |
| f07ddc95-d48e-4c08-a4a3-623d4ae39bbb | 2026-05-19 04:00 | M. Faraz Jamil | Wavetech Infomatics | BULK | Rebecca Thomas | 3053180755 | - | no@email.com |
| ef952f32-c21b-4bd0-b45e-e34530c4c45f | 2026-05-05 04:00 | Danish Waris | Wavetech Infomatics | BULK | Dorene Waid | 4067993592 | - | no@email.com |
| f8dab8bf-4b66-406c-8544-c4327f59fc3b | 2026-05-25 19:44 | John Abraham | Wavetech Infomatics | MANUAL | Teresa Daniel | 4808822244 | - | no@email.com |
| 6d23b065-f45e-45d7-a060-13d9f5bc26d2 | 2026-05-25 19:44 | Danish Waris | Wavetech Infomatics | MANUAL | Bertha Marshall | 3056243312 | - | no@email.com |
| 78db9201-f1c7-4468-bf48-da8f0176d740 | 2026-05-25 19:44 | Fatima Wajid | Wavetech Infomatics | MANUAL | Francis Foley | 6037903226 | - | no@email.com |
| 8030fa3e-c2bf-41ba-875b-254080f422c9 | 2026-05-25 19:39 | Maham Zahra | The Mejor Communications | MANUAL | Monica Thomas | 9133060070 | - | no@email.com |
| 400a1f69-7423-4e1a-8816-ded4bb09103e | 2026-05-02 04:00 | Onyx | Onyx | BULK | Toni Mcallister | 6075912572 | - | no@email.com |
| 924a9045-7b36-4ba4-b370-8d1599855f48 | 2026-05-25 19:44 | M. Abu Zar | Wavetech Infomatics | MANUAL | Yolanda Flores | 9738193395 | - | no@email.com |
| 891a3408-eacc-4b71-add8-da26d2c46915 | 2026-05-25 19:44 | Ameer Hamza | Wavetech Infomatics | MANUAL | John Matherne | 5042756773 | - | no@email.com |
| 35c4777d-15f9-4652-8a64-d05d18631682 | 2026-05-25 19:43 | Daud Rehman | Wavetech Infomatics | MANUAL | Cindy Woods | 9713377868 | - | no@email.com |
| a7347428-26a1-492a-aa69-435883bdfadc | 2026-05-25 19:44 | M. Faraz Jamil | Wavetech Infomatics | MANUAL | John Perkins | 5012891044 | - | no@email.com |
| c8fb7e56-6b8c-40ca-81a7-8c870c5ee993 | 2026-05-25 19:44 | Raheel Samson | Wavetech Infomatics | MANUAL | Gerald Lickman | 2106305994 | - | no@email.com |
| 7b481710-4ac4-4dab-b9ef-73bf66f4fab0 | 2026-05-25 19:44 | Junaid Umer Daraz | Wavetech Infomatics | MANUAL | Johnny Morgan | 9109860210 | - | no@email.com |
| 75a082a3-f215-41e8-982f-090796e2b1b0 | 2026-05-25 19:44 | John Abraham | Wavetech Infomatics | MANUAL | Katherine Curl | 8042198486 | - | no@email.com |
| 91b88031-7adb-438e-9c7a-4ea671d2793a | 2026-05-25 19:44 | Malahim Babar | Wavetech Infomatics | MANUAL | Angel Lopez | 8593823990 | - | no@email.com |
| eca60ff3-5e7d-4959-8f8e-1e31a3c148e6 | 2026-05-15 23:19 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Cathleen Ganos | 6035825475 | - | no@email.com |
| ddee4a23-6100-4856-a86f-a593ee45f27e | 2026-05-25 19:58 | Ali Shan | EasyTech Communications | MANUAL | Mary Haws | 5854519698 | - | no@email.com |
| 00266690-e4f2-40aa-b46a-ad93f7c9fff5 | 2026-05-25 19:58 | Ali Shan | EasyTech Communications | MANUAL | Joanna Morgan | 6152890602 | - | no@email.com |
| 277f0406-c953-42a5-a7c6-a888ad7b53ff | 2026-05-25 20:42 | Huzaifa Shafiq | EasyTech Communications | MANUAL | James Dyer | 4165875505 | - | no@email.com |
| 3ff64b35-235b-48c1-812a-a6126c04ba66 | 2026-05-06 17:02 | Salman Amjad | Wavetech Infomatics | BULK | Eddie Blackmon | 5615023756 | - | no@email.com |
| 9b357689-061b-4353-8e48-68727b740428 | 2026-05-13 04:00 | M. Iman Suleman | EasyTech Communications | BULK | Helen Hinton | 2514019012 | - | no@email.com |
| e1c23857-59b8-4676-b2c6-155403185163 | 2026-05-15 04:00 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Virginia Turner | 7279453161 | - | no@email.com |
| f400548b-8f3f-44fa-9e45-7b7cd7e25327 | 2026-05-05 21:57 | Huzaifa Shafiq | EasyTech Communications | BULK | Daniel Mccafferty | 8132100838 | - | no@email.com |
| 867e6ab7-4d5b-4c4b-a65a-bc2645b24440 | 2026-05-18 04:00 | Najeeha Tahir | The Mejor Communications | BULK | James Borst | 2185662939 | - | no@email.com |
| 20d1c015-d934-4e8c-a19c-d02454e773ce | 2026-05-20 04:00 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Nemorio Aguilar | 8137326759 | - | no@email.com |
| 46942bfe-efef-41f0-b8cf-52407078b020 | 2026-05-21 04:00 | Touseef Ahmad | Wavetech Infomatics | BULK | Robert Williams | 4693860890 | - | no@email.com |
| cc7ee1c5-05fc-431f-be65-847f2364dfdc | 2026-05-22 04:00 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Glenn Webster | 3479282579 | - | no@email.com |
| 102dc0e8-8b2a-4bb2-a3b8-afffbc0831a7 | 2026-05-25 20:42 | Farrukh Saleem | Wavetech Infomatics | MANUAL | Virginia Ranew | 8508195833 | - | no@email.com |
| 2eb89f83-36c8-4aef-8781-84214088869c | 2026-05-25 20:42 | Mubeen Jabbar | Wavetech Infomatics | MANUAL | Jane Bruce | 2708862422 | - | no@email.com |
| 7a45764c-e55a-40bf-a1ed-f252d2d4e933 | 2026-05-25 20:42 | M Rizwan | Wavetech Infomatics | MANUAL | Carla Hoskins | 3132850690 | - | no@email.com |
| 77e87e23-0e7b-4ae7-99fc-29d12794fc7e | 2026-05-25 20:42 | Muhammad Bilal | Wavetech Infomatics | MANUAL | Beth Batchelder | 4047028228 | - | no@email.com |
| 1b645aec-d6f9-4d49-9c62-18a51a891f35 | 2026-05-25 20:42 | Zain Ul Abidin Ali | EasyTech Communications | MANUAL | Christopher Mcgarity | 7708757314 | - | no@email.com |
| b34e428b-223c-4cf3-b6b5-7bd304e59754 | 2026-05-25 20:42 | M Rizwan | Wavetech Infomatics | MANUAL | Carla Hoskins | 3132850690 | - | no@email.com |
| 5abaf47e-30bc-46b3-9b71-f21f27813873 | 2026-05-25 20:42 | Qasim Suleman | Wavetech Infomatics | MANUAL | Rondel Close | 5599672784 | - | no@email.com |
| 26e1dbfb-e7c9-4a95-9e0d-285a56f6034d | 2026-05-25 20:42 | M Mohsin | Wavetech Infomatics | MANUAL | Valree Augustine | 8286998752 | - | no@email.com |
| 84fd3b70-49fa-4914-9c90-2b667c82405a | 2026-05-05 04:00 | Onyx | Onyx | BULK | Loretta Shivers | 7063611869 | - | no@email.com |
| 07d4a784-7909-442f-bdd1-f28fdb84f5c9 | 2026-05-08 04:00 | Kashif Saleem | Wavetech Infomatics | BULK | Timothy Dorris | 6154803319 | - | no@email.com |
| 63b478ad-6751-429c-b37c-f6069e028514 | 2026-05-25 19:43 | Daud Rehman | Wavetech Infomatics | MANUAL | Roger Kelley | 5807631435 | - | no@email.com |
| a274507c-607b-45a4-956b-24c2c7b6092e | 2026-05-01 04:00 | Hanan Arif | EasyTech Communications | BULK | Josephine Warner | 6027053070 | - | no@email.com |
| 42161df3-cd29-40db-9e8e-216ff0dfd324 | 2026-05-25 19:43 | Sidra Shahbaz | Wavetech Infomatics | MANUAL | Debbie Champeny | 6087588144 | - | no@email.com |
| 00d64a8e-df18-4cb1-9cde-5bf52c87841a | 2026-05-09 22:21 | Kashif Saleem | Wavetech Infomatics | BULK | Kevin O'neal | 3179656417 | - | no@email.com |
| 0e94749d-564c-4392-bd46-84335fc0917d | 2026-05-11 17:36 | Kashif Saleem | Wavetech Infomatics | BULK | Victor Whitfield | 3143378351 | - | no@email.com |
| b09ec64f-21c4-4a1e-a66f-13238b677ac3 | 2026-05-25 19:39 | Ali Haider | The Mejor Communications | MANUAL | Mae England | 9172077207 | - | no@email.com |
| 2aba5e81-baa5-46f2-b652-81ad41de15d2 | 2026-05-04 18:40 | Farrukh Saleem | Wavetech Infomatics | BULK | Richard L Justi | 6123632540 | OB | no@email.com |
| 04f79a78-c6e8-488a-a196-f0faa9d00fac | 2026-05-12 21:50 | M. Haris Zahid | Wavetech Infomatics | BULK | Robert Hughes | 6189719570 | - | no@email.com |
| 93862e53-3743-4d82-8408-e568c7d948d6 | 2026-05-12 21:54 | Salman Amjad | Wavetech Infomatics | BULK | Etta Williams | 7068871139 | - | no@email.com |
| 07409557-fcbb-4a9a-b106-4a58cfc80807 | 2026-05-12 22:40 | M. Haris Zahid | Wavetech Infomatics | BULK | Doris Gallop | 2523393907 | - | no@email.com |
| 4dad419b-9274-4c7d-949f-31b7656ff668 | 2026-05-13 17:33 | M. Haris Zahid | Wavetech Infomatics | BULK | Susan Kimble | 2679808525 | Ref CLI: 2152955505 | no@email.com |
| fc5057c1-20f7-40fe-a82b-e5531924505b | 2026-05-13 23:57 | Kashif Saleem | Wavetech Infomatics | BULK | Lorraine Earle | 8032696000 | - | no@email.com |
| 0dafdb20-cbc4-4f62-a245-5a22b990fff8 | 2026-05-08 21:30 | John Abraham | Wavetech Infomatics | BULK | Bob Abc | 9176995787 | 8557053079  //  SEBASTIAN ASTOR  // | no@email.com |
| 50d14551-f701-45dd-8fcf-bcb9bfde4e40 | 2026-05-12 22:04 | M. Haris Zahid | Wavetech Infomatics | BULK | Thomas Barone | 6107161971 | - | no@email.com |
| 29a0974a-0423-406b-be5b-698f85339923 | 2026-05-11 21:53 | Zain Ul Abidin Ali | EasyTech Communications | BULK | John J Vetere | 9176767972 | (973) 343-6898 | no@email.com |
| a037f03b-b9ff-4389-956c-fbac07bda965 | 2026-05-12 16:34 | Huzaifa Shafiq | EasyTech Communications | BULK | Rose O'hara | 5203449650 | - | no@email.com |
| 05e34d54-ce8b-400f-a57f-25dd3b96a777 | 2026-05-15 17:18 | Zain Ul Abidin Ali | EasyTech Communications | BULK | Brian Carter | 5159795775 | - | no@email.com |
| 5c0e0a5b-286c-45bb-94ec-d05774091e0a | 2026-05-04 22:08 | Sidra Shahbaz | Wavetech Infomatics | BULK | Lincoln Freeman | 5419415549 | freemanashland.us | no@email.com |

---

## 10. Email missing `@` — sales (128 rows)

Replace with `no@email.com` per request.

| sale_id | sale_date | closer | batch | reference | customer | phone | BAD email | replacement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 660f9540-2292-486c-b97e-9a4f08825d79 | 2026-05-27 21:52 | Syed Zulfiqar Ali Naqvi | BULK | 00003C1J | Glenn Webster | 3479282579 | - | no@email.com |
| 6fb9f8d5-09cf-47f8-be6c-a0f6b93c7576 | 2026-05-27 21:52 | Moiz Shahzad | BULK | 00003C1R | Ann Megargee | 8504454636 | - | no@email.com |
| 8539767c-49b6-400d-b1b4-849daa8db81e | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003AD1 | Laquinta Carter-simon | 4095403016 | - | no@email.com |
| df0d580b-3417-45a9-9e2f-cb126039aece | 2026-05-27 21:52 | Moiz Shahzad | BULK | MBH4490ZYQ | Linda Adkins | 3166171766 | - | no@email.com |
| 7b31212e-38ab-48f9-bd5e-86b52819de48 | 2026-05-27 21:51 | M. Ahad | BULK | MBH43CD2S1 | Josephine Warner | 6027053070 | - | no@email.com |
| c605622c-e311-4419-9b47-0f71056681c2 | 2026-05-27 21:51 | M. Hassan Butt | BULK | 0000394S | William Krebs | 2023681815 | - | no@email.com |
| 322387b0-166e-4596-aa8d-e4452572e492 | 2026-05-27 21:51 | M. Ahad | BULK | 0000395Z | Clarice Lang | 9186938404 | - | no@email.com |
| 2bd09d3c-5c5e-4e8a-8c4d-5224dcebd0f8 | 2026-05-27 21:51 | Awn Muhammad | BULK | MBH43CQUN7 | Grady Brown | 9726397058 | - | no@email.com |
| 7137060f-0145-45d5-a939-1431b1ad1d18 | 2026-05-27 21:51 | Aqib Amir | BULK | 0000396X | Virginia Ranew | 8508195833 | - | no@email.com |
| d4cbd38d-5e48-4d1d-9b10-36b87ad76655 | 2026-05-27 21:51 | Zain Ahmad Naeem | BULK | MBH436O51D | Sylvia Hylton | 4105127558 | - | no@email.com |
| 387140a4-16a1-4d82-ae7d-eec5c5b297a3 | 2026-05-27 21:51 | M. Hassan Butt | BULK | 3979 | Valree Augustine | 8286998752 | - | no@email.com |
| 64a6ac0c-393c-4d8a-87a4-3a67f5a45c1d | 2026-05-27 21:51 | Fahad Butt | BULK | 0000397T | Rondel Close | 5599672784 | - | no@email.com |
| cc9afb8f-3ad9-4497-acaa-1430194db760 | 2026-05-27 21:51 | Zain Ahmad Naeem | BULK | MBH43ANDF9 | Linda Gurley | 8502640337 | - | no@email.com |
| f61f3ea2-b943-4bae-818c-83a854f14a2c | 2026-05-27 21:51 | Fahad Butt | BULK | 0000398F | Terry Marler | 6183806776 | - | no@email.com |
| f8b41276-9462-4307-9b4b-ee95f19c8bfb | 2026-05-27 21:51 | M. Ahad | BULK | 0000399H | Jane Bruce | 2708862422 | - | no@email.com |
| bf992fc4-e30b-4ce4-8961-28c20e0df7bf | 2026-05-27 21:51 | M. Ahad | BULK | 0000399R | Kay Mcfarland | 2088303233 | - | no@email.com |
| b65cc56e-b22e-434d-ba9b-cb27bb411482 | 2026-05-27 21:51 | Awn Muhammad | BULK | 000039AD | Marylynn Burroughs | 5408411943 | - | no@email.com |
| 014ea70c-4fb6-4c01-8fe0-bdcfa179981e | 2026-05-27 21:51 | Zarar Ahmed | BULK | 000039B2 | Kathleen Raulerson | 9128432446 | - | no@email.com |
| 535bb537-f340-4a11-8826-186446d8f49a | 2026-05-27 21:51 | Syed Zulfiqar Ali Naqvi | BULK | 000038P1 | Toni Mcallister | 6075912572 | - | no@email.com |
| e8b7febb-2a28-410c-8806-1a719771b858 | 2026-05-27 21:51 | Muhammad Jazim Ali | BULK | 000039DG | Gregory Vasser | 4122433576 | - | no@email.com |
| 4108bc6a-b050-4ae9-b611-dfb1a19bd923 | 2026-05-27 21:51 | Aqib Amir | BULK | MBH43DQ5Z5 | Ernest Fuller | 2038867855 | - | no@email.com |
| a864e5ba-3ba1-4ee2-aa3e-582800c387a9 | 2026-05-27 21:51 | Aqib Amir | BULK | 000038HX | Georgia Lawrence | 3345444990 | - | no@email.com |
| 2d3d0be2-83c5-4d02-a790-da27ced76566 | 2026-05-27 21:51 | Muhammad Hasib Ullah | BULK | 000038WO | Jeffery Ford | 4095480682 | - | no@email.com |
| 5ce232ce-4b22-42c8-87d4-f9296d65c3ed | 2026-05-27 21:51 | Zain Ahmad Naeem | BULK | 000038EK | Nancy Larock | 9414470006 | - | no@email.com |
| 642b75a7-c2b1-4ee7-b8a4-ad755a96145a | 2026-05-27 21:51 | Aqib Amir | BULK | 000039HS | Carla Hoskins | 3132850690 | - | no@email.com |
| c7474b1d-13b6-43b5-8d24-918987d177b2 | 2026-05-27 21:51 | Muhammad Hasib Ullah | BULK | MBH43F07HV | Betty Glaze | 7065759096 | - | no@email.com |
| 345c9ca1-0e13-4158-a4b6-fd0a3dca70cb | 2026-05-27 21:51 | Danish Waris | BULK | MBH43EWTGL | Beth Batchelder | 4047028228 | - | no@email.com |
| 94771fc8-5257-459d-ac2e-73ecbf0c74de | 2026-05-27 21:51 | Fahad Butt | BULK | 000039IP | Randall Thornton | 8049314110 | - | no@email.com |
| ca5666eb-adc7-429b-9c3d-c632d557ad82 | 2026-05-27 21:51 | Fahad Butt | BULK | 0000385V | Tina Cherchio | 3154404045 | - | no@email.com |
| 75984d8f-60f4-4050-98a3-cf59a44fe1e8 | 2026-05-27 21:51 | Aqib Amir | BULK | 000039KI | Angel Lopez | 8593823990 | - | no@email.com |
| 553a434a-da95-485e-8564-553770996eb0 | 2026-05-27 21:51 | Fahad Butt | BULK | 000039KL | James Dyer | 4165875505 | - | no@email.com |
| 667a0b1b-996b-4dd7-8b60-8b2107805f45 | 2026-05-27 21:51 | Syed Zulfiqar Ali Naqvi | BULK | 000039MG | John Matherne | 5042756773 | - | no@email.com |
| 343c3ae4-1a32-4f16-81ba-956b435031b2 | 2026-05-27 21:51 | Zain Ahmad Naeem | BULK | 000039NV | Euarl Moss | 6014828614 | - | no@email.com |
| cc7d550d-3a0e-425a-bed0-ce37c3a1c9aa | 2026-05-27 21:51 | Junaid Saeed | BULK | MBH43HKZ93 | Wesley Mcmillan | 8063823831 | - | no@email.com |
| 85bff51a-4e6e-417a-bc97-803ed86b20b0 | 2026-05-27 21:51 | Haroon Yousaf | BULK | 000039QP | Janice Whaley | 7125420255 | - | no@email.com |
| 18966897-1e8c-49e0-8264-7fd39ead4ad8 | 2026-05-27 21:51 | M. Hassan Butt | BULK | 000039Q3 | Jennifer Derstler | 7652788693 | - | no@email.com |
| e01bc7e5-1724-4d43-924f-ac2c44942a08 | 2026-05-27 21:51 | Junaid Saeed | BULK | 000039RJ | Loretta Shivers | 7063611869 | - | no@email.com |
| 58f4e853-da39-4734-95b1-9b07084db131 | 2026-05-27 21:51 | Zain Ahmad Naeem | BULK | 000039RM | Helen Suazo | 7185242233 | - | no@email.com |
| af0c219c-0841-42e6-9486-aa674016bad5 | 2026-05-27 21:51 | Fahad Butt | BULK | 000039RY | Teresa Daniel | 4808822244 | - | no@email.com |
| 2035399b-d2f7-4ce2-9054-491f65e76766 | 2026-05-27 21:51 | Zain Ahmad Naeem | BULK | 000039SC | Dorene Waid | 4067993592 | - | no@email.com |
| 73c93434-d7b8-400f-aa8d-1ff917177685 | 2026-05-27 21:51 | Hafiz Umer Malik | BULK | 000039SF | Gwendolyn Williams | 5044649121 | - | no@email.com |
| e749065f-f4ab-482f-b1ec-7814454ea356 | 2026-05-27 21:51 | Muhammad Hasib Ullah | BULK | 000039NL | Harry Coates | 8287122848 | - | no@email.com |
| fd3c48b4-7e06-4267-839f-32b25757ead0 | 2026-05-27 21:51 | Aqib Amir | BULK | 000038KM | Donald Nealey | 2812363331 | - | no@email.com |
| e8ce50d1-4e14-4c36-896d-a2d08c850bde | 2026-05-27 21:51 | M. Hassan Butt | BULK | 000039V0 | Katherine Curl | 8042198486 | - | no@email.com |
| 928ad6dc-5dde-450a-b413-474a3cf45339 | 2026-05-27 21:52 | Aqib Amir | BULK | MBH43K7VH2 | Mary Haws | 5854519698 | - | no@email.com |
| a7468f68-eaaf-4d59-8b3c-40340a419c3c | 2026-05-27 21:52 | M. Ahad | BULK | 000039XZ | Yolanda Flores | 9738193395 | - | no@email.com |
| eada99e3-807b-47fb-9d12-447de96e0ec4 | 2026-05-27 21:52 | Muhammad Jazim Ali | BULK | MBH43L6HBF | Dorothy Vandyke | 3863131240 | - | no@email.com |
| 93787d68-43d4-4fc2-af6a-e865a1464432 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003A09 | Christopher Mcgarity | 7708757314 | - | no@email.com |
| 12089f90-7cfd-47bf-9447-b3229732234e | 2026-05-27 21:52 | Awn Muhammad | BULK | 00003A0O | Carolyn Parsons | 4797742667 | - | no@email.com |
| d020f090-d4e4-47ce-a59a-2c8bbaba3810 | 2026-05-27 21:52 | Muhammad Hasib Ullah | BULK | 000039YZ | Diane Gibson | 4345948544 | - | no@email.com |
| 3799b9fd-55ee-4ba8-a882-e76da18817c4 | 2026-05-27 21:52 | Awn Muhammad | BULK | 00003A3C | Wayne Sprouse | 8284609367 | - | no@email.com |
| 9f4ac6c3-430f-4524-b215-0e1790554687 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003A2P | John Thompson | 7186585763 | - | no@email.com |
| 22282f91-c711-44bf-bc75-2db46c211c0f | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 000039X9 | Anthony Poole | 3479078820 | - | no@email.com |
| 54d42066-ddce-44ed-8ac4-a45e0d38e82f | 2026-05-27 21:52 | M. Ahad | BULK | 00003A6C | Jane Gettier | 7574267964 | - | no@email.com |
| 2aa0a66c-9887-4495-88f5-60f0e958a4f7 | 2026-05-27 21:52 | Aqib Amir | BULK | 00003A8U | Mark Ruiz | 2103478925 | - | no@email.com |
| 243ad956-4851-49c3-b94b-3746a4283192 | 2026-05-27 21:52 | M. Hassan Butt | BULK | 00003A92 | John Perkins | 5012891044 | - | no@email.com |
| e8276c7e-e527-4c90-8a04-7b247d2f4c95 | 2026-05-27 21:52 | Haroon Yousaf | BULK | 00003A86 | Roselinde Theobald | 3163699890 | - | no@email.com |
| c41eeb80-c9f8-49b5-a9e4-862832c3fbea | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003A9N | Timothy Dorris | 6154803319 | - | no@email.com |
| da7ad355-1cf4-4530-a8dc-f5fa48469bdd | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003AAO | Paul Brunetti | 9013154406 | - | no@email.com |
| 16b3d472-6f8b-4c08-9a57-29b0199f8a71 | 2026-05-27 21:52 | Fahad Butt | BULK | 00003ABF | David Vanalstyne | 9732719202 | - | no@email.com |
| 9cae2fb3-f09f-4116-8006-bf9dbbb1bd8b | 2026-05-27 21:52 | Muhammad Jazim Ali | BULK | MBH43O9259 | Monica Thomas | 9133060070 | - | no@email.com |
| 84cf368b-4158-4bc5-995b-3da367adcc18 | 2026-05-27 21:52 | Syed Zulfiqar Ali Naqvi | BULK | 000038EC | Levota Forrest | 8563453723 | - | no@email.com |
| 0d884f72-7122-4e2d-a0ca-7d78b0b58a48 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003AE5 | Jaret Butts | 2705977140 | - | no@email.com |
| 11389e0e-1a8b-4aa1-8d9f-c5e93efe5bb5 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003AHB | Rickey Grixgby | 5033147957 | - | no@email.com |
| f38ae12a-cfab-45cd-b99f-327874948947 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003AI0 | Johnny Morgan | 9109860210 | - | no@email.com |
| 194f3af9-db84-458d-9991-a873bfed3317 | 2026-05-27 21:52 | Haroon Yousaf | BULK | MBH43QCWHW | Ernestine Frye | 7048418281 | - | no@email.com |
| 7b104069-a0c4-4aa0-a455-560a076f9c6e | 2026-05-27 21:52 | M. Hassan Butt | BULK | 00003AIZ | Janice Rock | 6098837361 | - | no@email.com |
| 947228f9-d070-4f51-becd-42a0d73678ff | 2026-05-27 21:52 | Ahmed Zubair | BULK | 00003AMU | Joanna Morgan | 6152890602 | - | no@email.com |
| 6a8ae83c-d0c5-4692-8d2a-0f5e5efaf230 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003AOS | Jose Veliz | 3616764251 | - | no@email.com |
| 3d3ae387-f57e-4513-ba2f-59bccfc17161 | 2026-05-27 21:52 | Aqib Amir | BULK | 00003AOT | Jill Campbell | 3214316675 | - | no@email.com |
| a5d9fbee-a52c-4fa5-ac11-6e3d613a099e | 2026-05-27 21:52 | Fahad Butt | BULK | 00003AOG | Marion Johnson Jr. | 6788513263 | - | no@email.com |
| aa9186f1-beb9-4426-b4ee-a119d9c342a2 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003AP1 | Morris James | 9039751855 | - | no@email.com |
| 2682ada9-71be-4dc6-80c5-5b3e7df18f9f | 2026-05-27 21:52 | M. Ahad | BULK | 00003A2M | Helen Hinton | 2514019012 | - | no@email.com |
| 380a83ce-0135-48e8-a54a-ed5fbe377ebf | 2026-05-27 21:52 | M. Ahad | BULK | 00003A2D | Helen Hinton | 2514019012 | - | no@email.com |
| 2ebe48ff-4514-4802-a09d-07051f36d389 | 2026-05-27 21:52 | Haroon Yousaf | BULK | MBH43R5Z2F | Mae England | 9172077207 | - | no@email.com |
| 4cf132cd-fbbf-4c45-ac44-0662c889280e | 2026-05-27 21:52 | Aqib Amir | BULK | 00003AQZ | James Williams | 8643068301 | - | no@email.com |
| be7459af-f3b6-487d-be07-7f2d651d2e88 | 2026-05-27 21:52 | Fahad Butt | BULK | 00003AQT | Roy Mullins | 6065789907 | - | no@email.com |
| 1c158c2a-8708-4b12-a764-15205c1a8a13 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003ARD | Michael Era | 4023200858 | - | no@email.com |
| 50ae788b-1100-4237-b6fd-61a72e23a4aa | 2026-05-27 21:52 | Fahad Butt | BULK | 0000394P | Marylou Brosky | 7175765900 | - | no@email.com |
| 7ef9ac9f-1831-489b-bd2b-61b90a625b4b | 2026-05-27 21:52 | Fahad Butt | BULK | 00003AT7 | Michael Stevens | 6784012719 | - | no@email.com |
| 777131d4-9d65-4fd4-ad1d-fff6865e8902 | 2026-05-27 21:52 | Aqib Amir | BULK | 00003ATO | Stepahnie Mayfield | 3522228652 | - | no@email.com |
| f290149c-9db4-470c-808b-623e8afeb7dc | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003ARQ | Mitchell Freeman | 8645406556 | - | no@email.com |
| 8a763021-42cf-45ee-a4ed-96e0e25a762a | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003AU9 | Glenda Marshall | 2286976927 | - | no@email.com |
| bb78374a-3212-4dd6-8608-622855461315 | 2026-05-27 21:52 | Haroon Yousaf | BULK | MBH43UGZFU | Laurie Andrews | 4042345969 | - | no@email.com |
| 7e9b1fa5-b61f-4fba-93e2-2635e2be33d0 | 2026-05-27 21:52 | Fahad Butt | BULK | 00003AW5 | Loretta Craford | 5033714182 | - | no@email.com |
| d99d4ad4-380a-4dab-99dc-fc75c2af1e41 | 2026-05-27 21:52 | Fahad Butt | BULK | 00003AX4 | Vivian Glenn | 3137282708 | - | no@email.com |
| ad3f24eb-0ab2-4e23-9f79-f8b6cab688c0 | 2026-05-27 21:52 | M. Hassan Butt | BULK | 00003AXW | Carol Johnson | 6512955995 | - | no@email.com |
| 8579f9ac-796e-498d-a59c-3b6c5c82e7ed | 2026-05-27 21:52 | M. Hassan Butt | BULK | 00003AYA | Mark Reitnauer | 4849498526 | - | no@email.com |
| 73a41597-8b5d-4e5c-96a3-c5aba954f818 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003AYP | Glenn Stacks | 5015145006 | - | no@email.com |
| e4908eec-4ebe-42e3-8c80-97bbebc6d0c8 | 2026-05-27 21:52 | Aqib Amir | BULK | 00003AYT | Wayne Haight | 9045058231 | - | no@email.com |
| 79144500-cf36-4aef-b09f-4fba68c76a8d | 2026-05-27 21:52 | M. Bilal Nasir | BULK | 000039XN | Gerald Lickman | 2106305994 | - | no@email.com |
| f1ad13ec-d095-43fe-9cba-12d789396e3f | 2026-05-27 21:52 | Aqib Amir | BULK | 00003B19 | Darlene Lurks | 6518677526 | - | no@email.com |
| 572946e6-2ec2-4694-9878-bf6065bbd551 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003B1X | Virginia Turner | 7279453161 | - | no@email.com |
| 90dbdf9d-346b-411a-9a7e-f301b6bbbccb | 2026-05-27 21:52 | Haroon Yousaf | BULK | MBH43XH0CT | Gary Thomas | 7343955834 | - | no@email.com |
| ddc2be03-9f4e-48b8-bb3b-65f91bd68805 | 2026-05-27 21:52 | Muhammad Abdul Ahad | BULK | 00003B57 | Michael Zorn | 9794515548 | - | no@email.com |
| 1a91d22a-a868-4ac1-94ed-aa4dd74fa0c2 | 2026-05-27 21:52 | Syed Zulfiqar Ali Naqvi | BULK | MBH43YDSJP | Cathleen Ganos | 6035825475 | - | no@email.com |
| d613dfe2-1057-4868-b78f-014f3e5a5cda | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BAF | Marilyn Whitehurst | 5413504992 | - | no@email.com |
| bafa0e5d-ba56-491d-826d-6f31f88900e8 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BDI | Reginald Devaughn | 8505032100 | - | no@email.com |
| 00822a9e-ccb1-4145-972f-9ff5d7b177c1 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BD8 | Reginald Devaughn | 8505032100 | - | no@email.com |
| cbe28487-b93d-4ee5-9c22-fa3182e8b37e | 2026-05-27 21:52 | M. Ahad | BULK | 00003AMJ | Daniel Williams | 7125400511 | - | no@email.com |
| ac83bcc9-6e75-48b8-8880-b54250b06a0c | 2026-05-27 21:52 | Zarar Ahmed | BULK | MBH440NJAV | James Borst | 2185662939 | - | no@email.com |
| ed57a456-595b-47d9-93aa-15de5f44fa36 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BFM | Julie Scott | 5015143368 | - | no@email.com |
| e13afd14-3123-4f26-96bf-41afa1ec4ee4 | 2026-05-27 21:52 | Syed Zulfiqar Ali Naqvi | BULK | 00003BHD | Bertha Marshall | 3056243312 | - | no@email.com |
| a41059c1-c9e9-498c-8861-09e5b9b7f3fa | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003A87 | Rebecca Thomas | 3053180755 | - | no@email.com |
| 464494fa-ff6e-4584-9784-e32316e88afc | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BIX | Shirley Atkisson | 2565891675 | - | no@email.com |
| 218f2e72-64fc-43bb-ad78-199023e7c12d | 2026-05-27 21:52 | M. Ahad | BULK | 00003BJL | Patricio Pazmino | 9152025508 | - | no@email.com |
| 8c3b2070-eb6e-4b7f-9df2-607542ea8da5 | 2026-05-27 21:52 | Aqib Amir | BULK | MBH442RMX6 | Judy Daugherty | 2526714572 | - | no@email.com |
| c1219925-be9f-47e9-9127-bc83f00252b5 | 2026-05-27 21:52 | Syed Zulfiqar Ali Naqvi | BULK | 00003BKC | Michael Mikulka | 8323386589 | - | no@email.com |
| 94b2b641-3efb-49cf-a188-656dacc223f1 | 2026-05-27 21:52 | Muhammad Jazim Ali | BULK | 00003BLZ | Larry Parks | 6622873605 | - | no@email.com |
| 19aa5417-1ab9-44e3-8285-6af593367da3 | 2026-05-27 21:52 | Fahad Butt | BULK | 00003BOP | Cindy Woods | 9713377868 | - | no@email.com |
| 48be776f-4d69-4aae-8a3c-587ef05108bd | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BOM | Robert Maloney | 6039682317 | - | no@email.com |
| 62e103e4-b666-43d2-b477-e91528c7ada1 | 2026-05-27 21:52 | Danish Waris | BULK | 00003BPS | Francis Foley | 6037903226 | - | no@email.com |
| 41dbc193-51a8-47a3-9a73-9bf6e6084045 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BRB | Roger Kelley | 5807631435 | - | no@email.com |
| d8a13caa-ce28-450f-9f52-60488215cb7a | 2026-05-27 21:52 | Danish Waris | BULK | 00003BRI | Debbie Champeny | 6087588144 | - | no@email.com |
| c091fb2e-3439-4edd-b48d-966a5617159a | 2026-05-27 21:52 | M. Ahad | BULK | 00003BS0 | Nemorio Aguilar | 8137326759 | - | no@email.com |
| 82cfbd52-19d8-440f-b106-e149ae3e35d3 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BYF | Nancy Malcom | 4076444427 | - | no@email.com |
| 250121d4-b9b2-4e17-9674-c03f7b3ad95a | 2026-05-27 21:52 | Moiz Shahzad | BULK | 00003BTH | Lidya Vanbenthuysen | 4077873971 | - | no@email.com |
| 1e376cdf-dd37-404c-8cfd-e1e62ad3eb9f | 2026-05-27 21:52 | Muhammad Abdul Ahad | BULK | 00003BU5 | Alvin Eschuchhardt | 7574045052 | - | no@email.com |
| e347550a-78c3-4b93-a88b-9228a4270dc7 | 2026-05-27 21:52 | Syed Zulfiqar Ali Naqvi | BULK | 00003BU7 | Robert Williams | 4693860890 | - | no@email.com |
| 992f5be2-b47c-4ba0-9201-3d09376ad3b0 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BUM | Jack Stillabower | 9723421113 | - | no@email.com |
| 60c7b733-bd31-49b4-93d0-5495d6ab4b41 | 2026-05-27 21:52 | Fahad Butt | BULK | 00003BUR | Shirley Mcknight | 2035276723 | - | no@email.com |
| 7908fcc4-eea7-4c03-978b-0fa75901cbe1 | 2026-05-27 21:52 | Hafiz Umer Malik | BULK | MBH44653CF | Dudley Holt | 2547164577 | - | no@email.com |
| 04ecd7d1-6cc6-49a3-9a96-fe0e88a28d88 | 2026-05-27 21:52 | Muhammad Jazim Ali | BULK | MBH43GLENH | Marie Perkins | 6062646962 | - | no@email.com |
| 6e0a3280-cfa9-4d38-b4c7-b064554e44a6 | 2026-05-27 21:52 | M. Hassan Butt | BULK | 00003C4S | Virginia Laboy | 7864175565 | - | no@email.com |
| 1e96ce6f-8b7e-4f74-b2ae-fe917b34a7a4 | 2026-05-27 21:51 | Zain Ahmad Naeem | BULK | 3810 | Katherine Moore | 6033433123 | - | no@email.com |
| 669f24ac-7780-4cc8-882f-76cb8ae04fda | 2026-05-27 21:51 | Zain Ahmad Naeem | BULK | 000039W3 | Donald Fitzgerald | 8646178834 | - | no@email.com |
| bc6d4236-b99b-4d8c-89b1-a2980cddd167 | 2026-05-27 21:52 | Muhammad Abdul Ahad | BULK | 000035XH | Roosevelt Lawson | 8433594394 | - | no@email.com |
| c91b5995-2977-41a5-83eb-6a9fd1051f22 | 2026-05-27 21:52 | Zain Ahmad Naeem | BULK | 00003BZH | Elizabeth Nethery | 6016738696 | - | no@email.com |

---

## How to apply (SQL templates)

### State orphans → NULL
```sql
UPDATE transfers
SET    form_data = jsonb_set(form_data, '{State}', 'null'::jsonb)
WHERE  id IN (
  'b38138d1-3ad2-41a9-9e64-d5c34e77a3ad',
  'aaec0cd7-42d7-4c00-a02a-645bcf4243cb',
  '4d7de93d-b7f2-4158-8397-98a03e5970f8',
  '6b5cb3e2-1586-453c-9dff-6a643f473a8f',
  '2aba5e81-baa5-46f2-b652-81ad41de15d2'
);
```

### ZIP padding (auto, all fixable rows)
```sql
UPDATE transfers
SET    form_data = jsonb_set(form_data, '{Zip}', to_jsonb(
         lpad(regexp_replace(form_data->>'Zip', '\D', '', 'g'), 5, '0')
       ))
WHERE  form_data->>'Zip' IS NOT NULL
  AND  form_data->>'Zip' !~ '^\d{5}$'
  AND  length(regexp_replace(form_data->>'Zip', '\D', '', 'g')) BETWEEN 1 AND 4;
```

### ZIP junk → NULL (run AFTER padding pass)
```sql
UPDATE transfers
SET    form_data = jsonb_set(form_data, '{Zip}', 'null'::jsonb)
WHERE  form_data->>'Zip' IS NOT NULL
  AND  form_data->>'Zip' !~ '^\d{5}$';
```

### Emails missing `@` → `no@email.com`
```sql
-- Transfers (JSONB)
UPDATE transfers
SET    form_data = jsonb_set(form_data, '{Email}', '"no@email.com"'::jsonb)
WHERE  form_data->>'Email' IS NOT NULL
  AND  form_data->>'Email' !~ '@';

-- Sales (typed column)
UPDATE sales
SET    customer_email = 'no@email.com'
WHERE  customer_email IS NOT NULL
  AND  customer_email !~ '@';
```

### Phone issues — case-by-case
Use the suggestion column above. For digits.length === 11 with leading "1", strip the leading 1 (US country code). For everything else (letters, miles values, partial digits), set NULL and let the agent re-collect on next contact.

### VIN issues
2 rows. Both bulk uploads with off-by-one VIN length. Either lookup correct VIN externally or NULL the field; sale row stays intact.

---

## Notes

- All IDs are stable. Use them directly in WHERE clauses.
- No row should be deleted. Field-level NULL preserves audit trail.
- After this manual pass, ship migration 068 + backend validators to prevent recurrence (see DATA_AUDIT.md).
