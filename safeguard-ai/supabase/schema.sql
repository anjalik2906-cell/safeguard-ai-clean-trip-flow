create table incidents (id bigint generated always as identity primary key, type text, confirms int default 0, lat double precision, lng double precision, anonymous boolean default true, created_at timestamptz default now());
create table alerts (id bigint generated always as identity primary key, status text, score real, reason text, lat double precision, lng double precision, deadline timestamptz, notified jsonb, created_at timestamptz default now());
create table contacts (id bigint generated always as identity primary key, name text, phone text, created_at timestamptz default now());
create table sensor_logs (id bigint generated always as identity primary key, accel real, sound real, lat double precision, lng double precision, sos boolean, created_at timestamptz default now());
