FROM python:3.12-slim AS base

########################
# Install Dependencies #
########################

# Copy requirements.txt to container
COPY requirements.txt /tmp/requirements.txt

# Upgrade pip and install Python requirements
RUN pip3 install --upgrade pip ; \
    pip3 install --no-cache -r /tmp/requirements.txt ; \
    python -m playwright install --with-deps chromium
    # playwright install chromium --with-deps 2>/dev/null || true


###########
# Workdir #
###########

# Set workdir to app
WORKDIR /usr/src/app
ENV PYTHONPATH "${PYTHONPATH}:/usr/src/app"


##############################
# Define Default Dev Command #
##############################

CMD ["uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "8080"]


FROM base AS production

#############
# Copy Data #
#############

# Copy app to container
COPY ./src /usr/src/app


##########
# Verify #
##########

# Check content of app folder
RUN ls -la /usr/src/app


#####################################
# Define Default Production Command #
#####################################

# Start FastAPI server with Uvicorn in production mode.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
