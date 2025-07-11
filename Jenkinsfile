pipeline {
  agent any

  environment {
    DOCKERHUB_USER = 'rebelmitsui'
    IMAGE_NAME = 'backend'
    DOCKERHUB_PASSWORD = credentials('dockerhub-password')  // DockerHub token/password
  }

  stages {
    stage('Checkout') {
      steps {
        git url: 'https://github.com/ridwanhz/api-sample.git', branch: 'main'
      }
    }

    stage('Test') {
      steps {
        dir('backend') {
          sh 'npm install'
          sh 'npm test'
        }
      }
    }

    stage('Build & Push Docker Image') {
      steps {
          script {
            def tag = "staging-v${env.BUILD_NUMBER}"
            sh "docker build -t $DOCKERHUB_USER/$IMAGE_NAME:$tag ."
            sh "echo $DOCKERHUB_PASSWORD | docker login -u $DOCKERHUB_USER --password-stdin"
            sh "docker push $DOCKERHUB_USER/$IMAGE_NAME:$tag"
        }
      }
    }

    stage('Update K8s Manifest & Push to GitHub') {
      steps {
        dir('k8s-manifest') {
          script {
            def tag = "staging-v${env.BUILD_NUMBER}"

            // Update image tag in deployment.yaml
            sh "sed -i 's|image: .*|image: $DOCKERHUB_USER/$IMAGE_NAME:$tag|' 6-deployment.yaml"

            // Git config & commit
            sh "git config user.email 'zkrhawafi5@gmail.com'"
            sh "git config user.name 'ridwanhz'"
            sh "git commit -am 'Update image to $tag' || echo 'No changes to commit'"

            // Push to GitHub using credentials
            withCredentials([usernamePassword(credentialsId: 'github-creds', usernameVariable: 'GIT_USER', passwordVariable: 'GIT_PASS')]) {
              sh 'git remote set-url origin https://${GIT_USER}:${GIT_PASS}@github.com/ridwanhz/cms-backend.git'
              sh 'git push origin main'
            }
          }
        }
      }
    }
  }
}
