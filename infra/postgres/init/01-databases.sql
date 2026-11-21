-- The gateway stands in for an external company: it must not share the booking database.
CREATE ROLE booking_svc LOGIN PASSWORD 'booking';
CREATE ROLE gateway_svc LOGIN PASSWORD 'gateway';

CREATE DATABASE booking OWNER booking_svc;
CREATE DATABASE gateway OWNER gateway_svc;

-- By default every role may connect to every database.
REVOKE CONNECT ON DATABASE booking FROM PUBLIC;
REVOKE CONNECT ON DATABASE gateway FROM PUBLIC;
