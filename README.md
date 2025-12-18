# hawk-language-translation
hawk language translation


UI OCP Deployment Guide
Deploying to OpenShift Container Platform
This guide outlines the steps to deploy your Node.js application to an OpenShift cluster.

Prerequisites
OpenShift CLI (oc): Installed and logged in to your cluster.
Project Access: You must have a project (namespace) created or access to create one.
GCP Service Account Key: Since your app interacts with Google Cloud (Pub/Sub, BigQuery), you likely need a Service Account Key JSON file securely mounted or available to the pod, unless you are using Workload Identity.
Method 1: Deploy from Source (Simplest)
OpenShift's new-app command can build a container image directly from your source code using the source-to-image (S2I) strategy or by detecting the 
Dockerfile
.

Login to your cluster:

oc login <your-cluster-api-url>
Select or Create a Project:

oc project <project-name>
# OR create new
oc new-project hawk-translation-app
Run new-app: If you are in the directory containing the source code:

oc new-app . --name=translation-ui
Note: OpenShift will detect the 
Dockerfile
 and set up a BuildConfig and Deployment.

Follow Build Logs:

oc logs -f bc/translation-ui
Method 2: Build & Push Image Manually
If you prefer building the image locally or in a CI/CD pipeline and pushing to a registry (like OpenShift's internal registry or Google Artifact Registry).

Build the Image:

docker build -t translation-ui:v1 .
Tag for Registry: Example for Google Artifact Registry:

docker tag translation-ui:v1 region-docker.pkg.dev/your-project/repo/translation-ui:v1
Push the Image:

docker push region-docker.pkg.dev/your-project/repo/translation-ui:v1
Deploy in OpenShift:

oc new-app region-docker.pkg.dev/your-project/repo/translation-ui:v1 --name=translation-ui
Configuration
Your application requires environment variables (PROJECT_ID, TOPIC_ID) and likely authentication.

1. Set Environment Variables
Set the variables required by 
server.js
:

oc set env deployment/translation-ui \
  PROJECT_ID=your-gcp-project-id \
  TOPIC_ID=your-pubsub-topic-id
2. Configure GCP Authentication
Option A: GCP Workload Identity (Recommended) If your cluster supports it, configure the ServiceAccount to annotate with the GCP Service Account.

Option B: Service Account Key Secret

Create a secret from your JSON key file:
oc create secret generic gcp-sa-key --from-file=key.json=/path/to/service-account-key.json
Mount the secret and set GOOGLE_APPLICATION_CREDENTIALS:
oc set volume deployment/translation-ui --add --name=gcp-key --mount-path=/etc/gcp --secret-name=gcp-sa-key
oc set env deployment/translation-ui GOOGLE_APPLICATION_CREDENTIALS=/etc/gcp/key.json
Expose the Application
To make the UI accessible outside the cluster, create a Route.

Expose the Service:

oc expose svc/translation-ui
Get the URL:

oc get route translation-ui
Access the application using the URL provided in the HOST/PORT column.

Troubleshooting
Check Pod Status: oc get pods
View Application Logs: oc logs -f deployment/translation-ui
Check Events: oc get events --sort-by='.lastTimestamp'