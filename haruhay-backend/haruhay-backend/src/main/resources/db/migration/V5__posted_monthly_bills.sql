CREATE TABLE monthly_bills (
 id UUID PRIMARY KEY,
 tenancy_id UUID NOT NULL REFERENCES tenancies(id),
 application_id UUID NOT NULL REFERENCES registration_applications(id),
 property_id UUID NOT NULL REFERENCES properties(id),
 offer_id UUID NOT NULL REFERENCES application_offers(id),
 period VARCHAR(7) NOT NULL,
 due_date DATE NOT NULL,
 rent DECIMAL(12,2) NOT NULL CHECK(rent>=0),
 fixed_charges DECIMAL(12,2) NOT NULL CHECK(fixed_charges>=0),
 posted_by UUID NOT NULL REFERENCES accounts(id),
 posted_at TIMESTAMP WITH TIME ZONE NOT NULL,
 UNIQUE(tenancy_id,period)
);
