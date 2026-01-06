# use the mongodb/mongodb-atlas-local:8.0 image
FROM mongodb/mongodb-atlas-local:8.0

# copy the mongodb-init.js file to the container
COPY mongodb-init.js /docker-entrypoint-initdb.d/mongodb-init.js
