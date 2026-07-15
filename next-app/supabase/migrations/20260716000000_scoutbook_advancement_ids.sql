-- Scoutbook advancement IDs, from two sources:
--   1. A complete merit-badge name -> AdvancementID reference the user
--      confirmed as authoritative (2026-07-16) — stored in full below (164
--      names) so a badge not yet in merit_badges already has its ID on hand
--      the moment it's added to the catalog.
--   2. The standard fixed BSA rank sequence (Scout=1 ... Eagle=7), confirmed
--      against real historical ledger data cross-referenced with an actual
--      Scoutbook upload file.
--
-- merit_badges.scoutbook_id is corrected here for the current 69-badge
-- catalog using the reference table (trusting it over an earlier, apparently
-- wrong, population of that column).

create table public.scoutbook_merit_badge_reference (
  name text primary key,
  scoutbook_id text not null
);

alter table public.scoutbook_merit_badge_reference enable row level security;
create policy ref_read_all on public.scoutbook_merit_badge_reference for select using (true);

insert into public.scoutbook_merit_badge_reference (name, scoutbook_id) values
  ('Agribusiness', '3'),
  ('American Business', '4'),
  ('American Cultures', '5'),
  ('American Heritage', '65'),
  ('American Indian Culture', '7'),
  ('Animal Science', '152'),
  ('Animation', '8'),
  ('Archaeology', '9'),
  ('Archery', '10'),
  ('Architecture', '11'),
  ('Art', '157'),
  ('Artificial Intelligence', '12'),
  ('Astronomy', '13'),
  ('Athletics', '14'),
  ('American Labor', '6'),
  ('Automotive Maintenance', '15'),
  ('Aviation', '16'),
  ('Backpacking', '17'),
  ('Basketry', '18'),
  ('Beekeeping', '19'),
  ('Bird Study', '20'),
  ('Bookbinding', '21'),
  ('Botany', '22'),
  ('Bugling', '24'),
  ('Camping', '20'),
  ('Canoeing', '25'),
  ('Carpentry', '26'),
  ('Chemistry', '27'),
  ('Chess', '135'),
  ('Cinematography', '154'),
  ('Citizenship In Community', '24'),
  ('Citizenship In Nation', '25'),
  ('Citizenship In World', '26'),
  ('Citizenship in Society', '27'),
  ('Climbing', '28'),
  ('Coin Collecting', '29'),
  ('Collections', '30'),
  ('Communication', '30'),
  ('Composite Materials', '31'),
  ('Computers', '32'),
  ('Consumer Buying', '33'),
  ('Cooking', '33'),
  ('Crime Prevention', '34'),
  ('Cybersecurity', '158'),
  ('Cycling', '35'),
  ('Dentistry', '36'),
  ('Digital Technology', '148'),
  ('Disabilities Awareness', '37'),
  ('Dog Care', '38'),
  ('Drafting', '39'),
  ('Electricity', '40'),
  ('Electronics', '41'),
  ('Emergency Preparedness', '42'),
  ('Energy', '43'),
  ('Engineering', '44'),
  ('Entrepreneurship', '45'),
  ('Environmental Science', '46'),
  ('Exploration', '153'),
  ('Family Life', '47'),
  ('Farm Mechanics', '48'),
  ('Farm/Ranch Management', '49'),
  ('Fingerprinting', '50'),
  ('Fire Safety', '51'),
  ('First Aid', '52'),
  ('Fish and Wildlife', '53'),
  ('Fishing', '54'),
  ('Fly Fishing', '55'),
  ('Food Systems', '140'),
  ('Forestry', '55'),
  ('Game Design', '56'),
  ('Gardening', '57'),
  ('Genealogy', '58'),
  ('General Science', '59'),
  ('Geocaching', '58'),
  ('Geology', '59'),
  ('Golf', '60'),
  ('Graphic Arts', '61'),
  ('Health Care Professions', '155'),
  ('Hiking', '62'),
  ('Home Repairs', '63'),
  ('Horsemanship', '64'),
  ('Insect Study', '66'),
  ('Inventing', '67'),
  ('Journalism', '68'),
  ('Kayaking', '136'),
  ('Landscape Architecture', '69'),
  ('Law', '70'),
  ('Leatherwork', '71'),
  ('Lifesaving', '72'),
  ('Machinery', '73'),
  ('Mammal Study', '73'),
  ('Masonry', '74'),
  ('Medicine', '147'),
  ('Metals Engineering', '75'),
  ('Metalwork', '75'),
  ('Mining in Society', '147'),
  ('Model Design', '76'),
  ('Motorboating', '77'),
  ('Moviemaking', '23'),
  ('Multisport', '156'),
  ('Music', '78'),
  ('Nature', '79'),
  ('Nuclear Science', '80'),
  ('Oceanography', '81'),
  ('Orienteering', '82'),
  ('Painting', '83'),
  ('Pathfinding', '84'),
  ('Personal Fitness', '84'),
  ('Personal Management', '85'),
  ('Pets', '86'),
  ('Photography', '87'),
  ('Pioneering', '88'),
  ('Plant Science', '89'),
  ('Plumbing', '90'),
  ('Pottery', '91'),
  ('Print/Communications', '144'),
  ('Programming', '144'),
  ('Public Health', '92'),
  ('Public Speaking', '93'),
  ('Pulp and Paper', '94'),
  ('Rabbit Raising', '95'),
  ('Radio', '95'),
  ('Railroading', '96'),
  ('Reading', '97'),
  ('Reptile Study', '98'),
  ('Reptile/Amphibian Study', '98'),
  ('Rifle Shooting', '99'),
  ('Rifle/Shotgun', '132'),
  ('Robotics', '132'),
  ('Rowing', '100'),
  ('Safety', '101'),
  ('Salesmanship', '102'),
  ('Scholarship', '104'),
  ('Scouting Heritage', '103'),
  ('Scuba Diving', '105'),
  ('Sculpture', '106'),
  ('Search and Rescue', '137'),
  ('Shotgun Shooting', '107'),
  ('Signaling', '108'),
  ('Signs', 'Signals'),
  ('Skating', '108'),
  ('Skiing', '109'),
  ('Small Boat Sailing', '109'),
  ('Snow Sports', '110'),
  ('Soil and Water Conservation', '111'),
  ('Space Exploration', '112'),
  ('Sports', '113'),
  ('Stamp Collecting', '114'),
  ('Surveying', '115'),
  ('Sustainability', '142'),
  ('Swimming', '116'),
  ('Textile', '117'),
  ('Theater', '118'),
  ('Tracking', '119'),
  ('Traffic Safety', '120'),
  ('Truck Transportation', '121'),
  ('Veterinary Medicine', '122'),
  ('Water Sports', '123'),
  ('Weather', '124'),
  ('Welding', '133'),
  ('Whitewater', '125'),
  ('Wilderness Survival', '126'),
  ('Wood Carving', '127'),
  ('Woodwork', '128');

-- Rank Scoutbook IDs (fixed BSA sequence).
alter table public.ranks add column scoutbook_id text;

update public.ranks set scoutbook_id = '1' where id = 'scout';
update public.ranks set scoutbook_id = '2' where id = 'tenderfoot';
update public.ranks set scoutbook_id = '3' where id = 'second-class';
update public.ranks set scoutbook_id = '4' where id = 'first-class';
update public.ranks set scoutbook_id = '5' where id = 'star';
update public.ranks set scoutbook_id = '6' where id = 'life';
update public.ranks set scoutbook_id = '7' where id = 'eagle';

-- Merit badge Scoutbook IDs, corrected against the reference table above.
update public.merit_badges set scoutbook_id = '152' where id = 'animal-science';
update public.merit_badges set scoutbook_id = '10' where id = 'archery';
update public.merit_badges set scoutbook_id = '157' where id = 'art';
update public.merit_badges set scoutbook_id = '13' where id = 'astronomy';
update public.merit_badges set scoutbook_id = '16' where id = 'aviation';
update public.merit_badges set scoutbook_id = '18' where id = 'basketry';
update public.merit_badges set scoutbook_id = '20' where id = 'camping';
update public.merit_badges set scoutbook_id = '25' where id = 'canoeing';
update public.merit_badges set scoutbook_id = '135' where id = 'chess';
update public.merit_badges set scoutbook_id = '27' where id = 'citizenship-society';
update public.merit_badges set scoutbook_id = '24' where id = 'citizenship-community';
update public.merit_badges set scoutbook_id = '25' where id = 'citizenship-nation';
update public.merit_badges set scoutbook_id = '26' where id = 'citizenship-world';
update public.merit_badges set scoutbook_id = '28' where id = 'climbing';
update public.merit_badges set scoutbook_id = '30' where id = 'communication';
update public.merit_badges set scoutbook_id = '33' where id = 'cooking';
update public.merit_badges set scoutbook_id = '35' where id = 'cycling';
update public.merit_badges set scoutbook_id = '148' where id = 'digital-technology';
update public.merit_badges set scoutbook_id = '40' where id = 'electricity';
update public.merit_badges set scoutbook_id = '42' where id = 'emergency-preparedness';
update public.merit_badges set scoutbook_id = '44' where id = 'engineering';
update public.merit_badges set scoutbook_id = '46' where id = 'environmental-science';
update public.merit_badges set scoutbook_id = '47' where id = 'family-life';
update public.merit_badges set scoutbook_id = '50' where id = 'fingerprinting';
update public.merit_badges set scoutbook_id = '51' where id = 'fire-safety';
update public.merit_badges set scoutbook_id = '52' where id = 'first-aid';
update public.merit_badges set scoutbook_id = '54' where id = 'fishing';
update public.merit_badges set scoutbook_id = '55' where id = 'forestry';
update public.merit_badges set scoutbook_id = '56' where id = 'game-design';
update public.merit_badges set scoutbook_id = '59' where id = 'geology';
update public.merit_badges set scoutbook_id = '62' where id = 'hiking';
update public.merit_badges set scoutbook_id = '64' where id = 'horsemanship';
update public.merit_badges set scoutbook_id = '66' where id = 'insect-study';
update public.merit_badges set scoutbook_id = '136' where id = 'kayaking';
update public.merit_badges set scoutbook_id = '70' where id = 'law';
update public.merit_badges set scoutbook_id = '71' where id = 'leatherwork';
update public.merit_badges set scoutbook_id = '72' where id = 'lifesaving';
update public.merit_badges set scoutbook_id = '73' where id = 'mammal-study';
update public.merit_badges set scoutbook_id = '75' where id = 'metalwork';
update public.merit_badges set scoutbook_id = '77' where id = 'motorboating';
update public.merit_badges set scoutbook_id = '79' where id = 'nature';
update public.merit_badges set scoutbook_id = '80' where id = 'nuclear-science';
update public.merit_badges set scoutbook_id = '84' where id = 'personal-fitness';
update public.merit_badges set scoutbook_id = '85' where id = 'personal-management';
update public.merit_badges set scoutbook_id = '87' where id = 'photography';
update public.merit_badges set scoutbook_id = '88' where id = 'pioneering';
update public.merit_badges set scoutbook_id = '91' where id = 'pottery';
update public.merit_badges set scoutbook_id = '144' where id = 'programming';
update public.merit_badges set scoutbook_id = '93' where id = 'public-speaking';
update public.merit_badges set scoutbook_id = '94' where id = 'pulp-and-paper';
update public.merit_badges set scoutbook_id = '99' where id = 'rifle-shooting';
update public.merit_badges set scoutbook_id = '132' where id = 'robotics';
update public.merit_badges set scoutbook_id = '100' where id = 'rowing';
update public.merit_badges set scoutbook_id = '106' where id = 'sculpture';
update public.merit_badges set scoutbook_id = '137' where id = 'search-and-rescue';
update public.merit_badges set scoutbook_id = '107' where id = 'shotgun-shooting';
update public.merit_badges set scoutbook_id = '151' where id = 'signs-signals-codes';
update public.merit_badges set scoutbook_id = '109' where id = 'small-boat-sailing';
update public.merit_badges set scoutbook_id = '110' where id = 'snow-sports';
update public.merit_badges set scoutbook_id = '111' where id = 'soil-and-water-conservation';
update public.merit_badges set scoutbook_id = '112' where id = 'space-exploration';
update public.merit_badges set scoutbook_id = '116' where id = 'swimming';
update public.merit_badges set scoutbook_id = '117' where id = 'textile';
update public.merit_badges set scoutbook_id = '124' where id = 'weather';
update public.merit_badges set scoutbook_id = '133' where id = 'welding';
update public.merit_badges set scoutbook_id = '126' where id = 'wilderness-survival';
update public.merit_badges set scoutbook_id = '127' where id = 'wood-carving';
update public.merit_badges set scoutbook_id = '128' where id = 'woodwork';
