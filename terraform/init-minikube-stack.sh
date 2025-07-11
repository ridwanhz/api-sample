#!/bin/bash
set -e

# Update & install base dependencies
apt update && apt upgrade -y
apt install -y curl wget apt-transport-https ca-certificates gnupg lsb-release software-properties-common nano

# Install Docker
apt install -y docker.io
systemctl enable docker
usermod -aG docker ubuntu

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install Minikube
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
install minikube-linux-amd64 /usr/local/bin/minikube

# Start Minikube (as ubuntu user)
su - ubuntu -c "minikube start --driver=docker"

# Enable Ingress
su - ubuntu -c "minikube addons enable ingress"

# Wait for ingress service to be ready
sleep 30

# Get Minikube IP and dynamic ingress port
MINIKUBE_IP=$(su - ubuntu -c "minikube ip")
INGRESS_PORT=$(kubectl get svc ingress-nginx-controller -n ingress-nginx -o=jsonpath="{.spec.ports[?(@.port==80)].nodePort}")

# Backup existing Nginx default site config
cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak

# Install Nginx
apt install -y nginx

# Replace Nginx config with reverse proxy to Minikube ingress
cat <<EOF > /etc/nginx/sites-available/default
server {
    listen 80;
    server_name localhost;

    location / {
        proxy_pass http://$MINIKUBE_IP:$INGRESS_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

# Restart Nginx
systemctl restart nginx

# Install Jenkins
curl -fsSL https://pkg.jenkins.io/debian/jenkins.io-2023.key | tee /usr/share/keyrings/jenkins-keyring.asc > /dev/null
echo deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian binary/ | tee /etc/apt/sources.list.d/jenkins.list > /dev/null
apt update
apt install -y openjdk-17-jdk jenkins
systemctl enable jenkins
systemctl start jenkins

# Add Jenkins to Docker group
usermod -aG docker jenkins

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs
